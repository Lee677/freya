// SPDX-License-Identifier: LGPL-2.1-or-later
/***************************************************************************
 *   Copyright (c) 2011 Konstantinos Poulios <logari81@gmail.com>          *
 *   Copyright (c) 2026 the freyacad authors (JavaScript port)             *
 *                                                                         *
 *   This file is part of the FreeCAD CAx development system.              *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or         *
 *   modify it under the terms of the GNU Library General Public           *
 *   License as published by the Free Software Foundation; either          *
 *   version 2 of the License, or (at your option) any later version.      *
 *                                                                         *
 *   This library  is distributed in the hope that it will be useful,      *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU Library General Public License for more details.                  *
 *                                                                         *
 *   You should have received a copy of the GNU Library General Public     *
 *   License along with this library; see the file LICENSE-planegcs.txt.   *
 *   If not, write to the Free Software Foundation, Inc., 59 Temple Place, *
 *   Suite 330, Boston, MA  02111-1307, USA                                *
 ***************************************************************************/
/*
 * planegcs.js — a JavaScript port of PlaneGCS, the 2D geometric constraint
 * solver of FreeCAD's Sketcher.
 *
 * Upstream source:
 *   https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs
 * Ported from branch main at commit
 *   fda5c1438057ec84fb1d5bd0f45fb29e94e0c8e1   (fetched 2026-08-27)
 * Files read for the port: GCS.h, GCS.cpp, Constraints.h, Constraints.cpp,
 *   SubSystem.h, SubSystem.cpp, Geo.h, Geo.cpp, Util.h, qp_eq.cpp.
 *
 * WHAT IS PORTED FROM UPSTREAM (structure and mathematics kept faithfully;
 * C++ "double*" parameters become JS objects {v:number}, whose identity plays
 * the role the pointer played):
 *   - DeriVector2, Point, Line, Circle                       (Geo.h/Geo.cpp)
 *   - Constraint base + Equal, Difference, P2PDistance, P2PAngle,
 *     P2LDistance, PointOnLine, PointOnPerpBisector, Parallel, Perpendicular,
 *     L2LAngle, MidpointOnLine, TangentCircumf, EqualLineLength, with their
 *     error(), grad() and maxStep() bodies                   (Constraints.cpp)
 *   - SubSystem: parameter redirection, residual, Jacobian, gradient, maxStep,
 *     applySolution                                          (SubSystem.cpp)
 *   - System: declareUnknowns, addConstraint* helpers, initSolution with
 *     connected-component partitioning and equality reduction, solve()
 *     dispatch, solve_BFGS, solve_LM, solve_DL (DogLeg), the constrained
 *     two-subsystem SQP solve(A,B), lineSearch, applySolution, and diagnose()
 *     with its QR rank analysis, dependent-parameter groups and the
 *     conflicting/redundant/partially-redundant classification   (GCS.cpp)
 *   - qp_eq, the equality-constrained QP the SQP step needs      (qp_eq.cpp)
 *
 * WHAT IS NOT PORTED: arcs, ellipses, hyperbolas, parabolas, B-splines and
 * every constraint that only they reach; the sparse-QR diagnosis path (the
 * dense path is used unconditionally — see qrAlgorithm below); Boost graph
 * (the connected-components pass is a plain union-find here); the debug and
 * solver-reporting scaffolding.
 *
 * WHAT IS NEW HERE (written for freyacad, not upstream, but part of this
 * library and so under the same licence):
 *   - the dense linear algebra this port reaches, which upstream gets from
 *     Eigen: full-pivoting Householder QR (rank, R, column permutation, Q,
 *     least-squares solve), full-pivoting LU solve, LDL^T solve, and the
 *     handful of matrix products used by the solvers.  Algorithms follow
 *     Eigen's, so that rank decisions and pivot orders agree with upstream's.
 *   - ConstraintPolygonCorner: an internal-alignment constraint binding a
 *     point to the k-th corner of a regular n-gon held as (cx,cy,r,rot).
 *     freyacad stores regular polygons in that reduced form; upstream has no
 *     such primitive.  It follows the pattern upstream uses for an ellipse's
 *     focus: two auxiliary parameters plus two internal-alignment equations,
 *     so the shape keeps exactly its four degrees of freedom.
 *
 * Deviations from upstream, all deliberate:
 *   - ConstraintEqual::grad returns -ratio (not -1) for its second parameter.
 *     Upstream returns -1, which is only correct for the default ratio of 1;
 *     the difference is invisible upstream because the ratio form is used for
 *     radius-vs-diameter, whose diameter parameter is a constant.
 *   - calcJacobi walks each constraint's own parameter list instead of every
 *     parameter of the subsystem.  Same matrix, but O(constraints x params
 *     per constraint) rather than O(constraints x params).
 *   - diagnose() runs its two QR decompositions in sequence (no threads).
 */
(function(global){
'use strict';

/* ===================================================================== */
/* Dense linear algebra.  Row-major flat arrays; the operations here are  */
/* the ones the ported solver paths actually reach, and no more.          */
/* ===================================================================== */

function Mat(r,c){ this.r=r|0; this.c=c|0; this.d=new Float64Array(this.r*this.c); }
Mat.prototype.get=function(i,j){ return this.d[i*this.c+j]; };
Mat.prototype.set=function(i,j,v){ this.d[i*this.c+j]=v; };
Mat.prototype.add=function(i,j,v){ this.d[i*this.c+j]+=v; };
Mat.prototype.zero=function(){ this.d.fill(0); return this; };
Mat.prototype.clone=function(){ const m=new Mat(this.r,this.c); m.d.set(this.d); return m; };
function matIdentity(n){ const m=new Mat(n,n); for(let i=0;i<n;i++)m.d[i*n+i]=1; return m; }
function vecZero(n){ return new Float64Array(n); }
function vecNorm(v){ let s=0; for(let i=0;i<v.length;i++)s+=v[i]*v[i]; return Math.sqrt(s); }
function vecSqNorm(v){ let s=0; for(let i=0;i<v.length;i++)s+=v[i]*v[i]; return s; }
function vecInfNorm(v){ let s=0; for(let i=0;i<v.length;i++){const a=Math.abs(v[i]); if(a>s)s=a;} return s; }
function vecL1(v){ let s=0; for(let i=0;i<v.length;i++)s+=Math.abs(v[i]); return s; }
function vecDot(a,b){ let s=0; for(let i=0;i<a.length;i++)s+=a[i]*b[i]; return s; }
// y = A*x
function matVec(A,x,out){ const y=out||vecZero(A.r);
  for(let i=0;i<A.r;i++){ let s=0; const o=i*A.c;
    for(let j=0;j<A.c;j++){ const a=A.d[o+j]; if(a!==0)s+=a*x[j]; }
    y[i]=s; }
  return y; }
// y = A^T*x
function matTVec(A,x,out){ const y=out||vecZero(A.c); y.fill(0);
  for(let i=0;i<A.r;i++){ const xi=x[i]; if(xi===0)continue; const o=i*A.c;
    for(let j=0;j<A.c;j++)y[j]+=A.d[o+j]*xi; }
  return y; }
// C = A*B
function matMul(A,B){ const C=new Mat(A.r,B.c);
  for(let i=0;i<A.r;i++){ const oa=i*A.c, oc=i*C.c;
    for(let k=0;k<A.c;k++){ const a=A.d[oa+k]; if(a===0)continue; const ob=k*B.c;
      for(let j=0;j<B.c;j++)C.d[oc+j]+=a*B.d[ob+j]; } }
  return C; }
// C = A^T*B
function matTMul(A,B){ const C=new Mat(A.c,B.c);
  for(let k=0;k<A.r;k++){ const oa=k*A.c, ob=k*B.c;
    for(let i=0;i<A.c;i++){ const a=A.d[oa+i]; if(a===0)continue; const oc=i*C.c;
      for(let j=0;j<B.c;j++)C.d[oc+j]+=a*B.d[ob+j]; } }
  return C; }
/* C = A*B^T. This is where J*J^T is formed, once per DogLeg iteration, and a
   constraint Jacobian is nearly all zeros — each row touches at most a handful
   of parameters. Walking each row's nonzeros instead of its full width turns
   the dominant cost of a solve from O(rows^2 * params) into O(rows * nonzeros
   per row * rows), which on a hundred-entity sketch is a factor of fifty. */
function matMulT(A,B){ const C=new Mat(A.r,B.r);
  const idx=new Int32Array(A.c), val=new Float64Array(A.c);
  for(let i=0;i<A.r;i++){ const oa=i*A.c, oc=i*C.c;
    let nz=0;
    for(let k=0;k<A.c;k++){ const a=A.d[oa+k]; if(a!==0){ idx[nz]=k; val[nz]=a; nz++; } }
    if(nz===0)continue;
    for(let j=0;j<B.r;j++){ const ob=j*B.c; let s=0;
      for(let t=0;t<nz;t++)s+=val[t]*B.d[ob+idx[t]]; C.d[oc+j]=s; } }
  return C; }
function matTranspose(A){ const T=new Mat(A.c,A.r);
  for(let i=0;i<A.r;i++)for(let j=0;j<A.c;j++)T.d[j*T.c+i]=A.d[i*A.c+j];
  return T; }

const EPS_MACH = 2.220446049250313e-16;

/* Full-pivoting Householder QR, after Eigen's FullPivHouseholderQR: it
   permutes rows and columns so the pivot is the largest entry left in the
   trailing block, which is what makes the rank it reports trustworthy.
   P1*A*P2 = Q*R, and colPerm[i] names the original column now at pivot i —
   the mapping the diagnosis uses to point at a constraint by name. */
function FullPivQR(A){
  const m=A.r, n=A.c, size=Math.min(m,n);
  const qr=A.clone();
  this.m=m; this.n=n; this.size=size; this.qr=qr;
  this.hCoeffs=vecZero(size);
  this.rowTrans=new Int32Array(size);
  this.colPerm=new Int32Array(n);
  for(let i=0;i<n;i++)this.colPerm[i]=i;
  this.nonzeroPivots=size;
  this.maxPivot=0;
  const prec=EPS_MACH*(size>0?size:1);
  let biggest=0;
  for(let k=0;k<size;k++){
    let bi=k, bj=k, best=-1;
    for(let i=k;i<m;i++){ const o=i*n;
      for(let j=k;j<n;j++){ const a=Math.abs(qr.d[o+j]); if(a>best){best=a;bi=i;bj=j;} } }
    if(k===0)biggest=best;
    if(!(best>biggest*prec)){                 // trailing block is negligible
      this.nonzeroPivots=k;
      for(let i=k;i<size;i++){ this.rowTrans[i]=i; this.hCoeffs[i]=0; }
      break;
    }
    this.rowTrans[k]=bi;
    if(bi!==k){ for(let j=k;j<n;j++){ const t=qr.d[k*n+j]; qr.d[k*n+j]=qr.d[bi*n+j]; qr.d[bi*n+j]=t; } }
    if(bj!==k){ for(let i=0;i<m;i++){ const t=qr.d[i*n+k]; qr.d[i*n+k]=qr.d[i*n+bj]; qr.d[i*n+bj]=t; }
      const t=this.colPerm[k]; this.colPerm[k]=this.colPerm[bj]; this.colPerm[bj]=t; }
    // Householder on qr[k..m-1][k], Eigen's makeHouseholderInPlace
    let tailSq=0;
    for(let i=k+1;i<m;i++){ const v=qr.d[i*n+k]; tailSq+=v*v; }
    const c0=qr.d[k*n+k];
    let tau=0, beta=c0;
    if(tailSq>0){
      beta=Math.sqrt(c0*c0+tailSq);
      if(c0>=0)beta=-beta;
      const inv=1/(c0-beta);
      for(let i=k+1;i<m;i++)qr.d[i*n+k]*=inv;
      tau=(beta-c0)/beta;
    }
    this.hCoeffs[k]=tau;
    qr.d[k*n+k]=beta;
    if(Math.abs(beta)>this.maxPivot)this.maxPivot=Math.abs(beta);
    if(tau!==0){
      for(let j=k+1;j<n;j++){
        let s=qr.d[k*n+j];
        for(let i=k+1;i<m;i++)s+=qr.d[i*n+k]*qr.d[i*n+j];
        s*=tau;
        qr.d[k*n+j]-=s;
        for(let i=k+1;i<m;i++)qr.d[i*n+j]-=qr.d[i*n+k]*s;
      }
    }
  }
}
/* Eigen counts a pivot as nonzero when it clears maxPivot*threshold. */
FullPivQR.prototype.rank=function(threshold){
  const th=(threshold==null?EPS_MACH*this.size:threshold)*this.maxPivot;
  let r=0;
  for(let i=0;i<this.nonzeroPivots;i++) if(Math.abs(this.qr.d[i*this.n+i])>th)r++;
  return r;
};
// upper triangular R: min(m,n) rows by n columns, matching upstream's trim
FullPivQR.prototype.matrixR=function(){
  const rows=Math.min(this.m,this.n), R=new Mat(rows,this.n);
  for(let i=0;i<rows;i++)for(let j=i;j<this.n;j++)R.d[i*this.n+j]=this.qr.d[i*this.n+j];
  return R;
};
// c <- Q^T*c, in place, on a column vector of length m
FullPivQR.prototype.applyQtLeft=function(c){
  const m=this.m, n=this.n;
  for(let k=0;k<this.nonzeroPivots;k++){
    const rt=this.rowTrans[k];
    if(rt!==k){ const t=c[k]; c[k]=c[rt]; c[rt]=t; }
    const tau=this.hCoeffs[k];
    if(tau===0)continue;
    let s=c[k];
    for(let i=k+1;i<m;i++)s+=this.qr.d[i*n+k]*c[i];
    s*=tau;
    c[k]-=s;
    for(let i=k+1;i<m;i++)c[i]-=this.qr.d[i*n+k]*s;
  }
  return c;
};
// full Q (m x m), built by applying Q to the identity's columns
FullPivQR.prototype.matrixQ=function(){
  const m=this.m, n=this.n, Q=matIdentity(m);
  for(let k=this.nonzeroPivots-1;k>=0;k--){
    const tau=this.hCoeffs[k];
    if(tau!==0){
      for(let j=k;j<m;j++){                    // Q rows k..m-1, columns k..m-1
        let s=Q.d[k*m+j];
        for(let i=k+1;i<m;i++)s+=this.qr.d[i*n+k]*Q.d[i*m+j];
        s*=tau;
        Q.d[k*m+j]-=s;
        for(let i=k+1;i<m;i++)Q.d[i*m+j]-=this.qr.d[i*n+k]*s;
      }
    }
    const rt=this.rowTrans[k];
    if(rt!==k){ for(let j=0;j<m;j++){ const t=Q.d[k*m+j]; Q.d[k*m+j]=Q.d[rt*m+j]; Q.d[rt*m+j]=t; } }
  }
  return Q;
};
/* Least-squares solve, following Eigen's: apply Q^T, back-substitute over the
   nonzero pivots, scatter through the column permutation (free variables of a
   rank-deficient system come back as zero, exactly as Eigen leaves them). */
FullPivQR.prototype.solve=function(b,threshold){
  const m=this.m, n=this.n;
  const th=(threshold==null?EPS_MACH*this.size:threshold)*this.maxPivot;
  let nz=0;
  for(let i=0;i<this.nonzeroPivots;i++){ if(Math.abs(this.qr.d[i*n+i])>th)nz++; else break; }
  const c=new Float64Array(m);
  for(let i=0;i<m;i++)c[i]=b[i];
  this.applyQtLeft(c);
  for(let i=nz-1;i>=0;i--){
    let s=c[i];
    for(let j=i+1;j<nz;j++)s-=this.qr.d[i*n+j]*c[j];
    c[i]=s/this.qr.d[i*n+i];
  }
  const x=vecZero(n);
  for(let i=0;i<nz;i++)x[this.colPerm[i]]=c[i];
  return x;
};

/* Full-pivoting LU with the same solve semantics Eigen's FullPivLU has: for a
   singular matrix it returns one particular solution, the free variables set
   to zero.  LM leans on this when its augmented normal matrix goes singular. */
function fullPivLuSolve(Ain,b){
  const n=Ain.r, A=Ain.clone();
  const rowP=new Int32Array(n), colP=new Int32Array(n);
  for(let i=0;i<n;i++){ rowP[i]=i; colP[i]=i; }
  let biggest=0, nonzero=n;
  const prec=EPS_MACH*(n>0?n:1);
  for(let k=0;k<n;k++){
    let bi=k, bj=k, best=-1;
    for(let i=k;i<n;i++){ const o=i*n;
      for(let j=k;j<n;j++){ const a=Math.abs(A.d[o+j]); if(a>best){best=a;bi=i;bj=j;} } }
    if(k===0)biggest=best;
    if(!(best>biggest*prec)){ nonzero=k; break; }
    if(bi!==k){ for(let j=0;j<n;j++){ const t=A.d[k*n+j]; A.d[k*n+j]=A.d[bi*n+j]; A.d[bi*n+j]=t; }
      const t=rowP[k]; rowP[k]=rowP[bi]; rowP[bi]=t; }
    if(bj!==k){ for(let i=0;i<n;i++){ const t=A.d[i*n+k]; A.d[i*n+k]=A.d[i*n+bj]; A.d[i*n+bj]=t; }
      const t=colP[k]; colP[k]=colP[bj]; colP[bj]=t; }
    const piv=A.d[k*n+k];
    for(let i=k+1;i<n;i++){
      const f=A.d[i*n+k]/piv;
      A.d[i*n+k]=f;
      if(f===0)continue;
      for(let j=k+1;j<n;j++)A.d[i*n+j]-=f*A.d[k*n+j];
    }
  }
  const c=vecZero(n);
  for(let i=0;i<n;i++)c[i]=b[rowP[i]];
  for(let i=1;i<n;i++){ let s=c[i]; for(let j=0;j<Math.min(i,nonzero);j++)s-=A.d[i*n+j]*c[j]; c[i]=s; }
  const y=vecZero(n);
  for(let i=nonzero-1;i>=0;i--){
    let s=c[i];
    for(let j=i+1;j<nonzero;j++)s-=A.d[i*n+j]*y[j];
    y[i]=s/A.d[i*n+i];
  }
  const x=vecZero(n);
  for(let i=0;i<n;i++)x[colP[i]]=y[i];
  return x;
}

/* LDL^T with symmetric pivoting, for the semidefinite normal matrix J*J^T the
   DogLeg step forms.  Tiny pivots are dropped rather than divided by, which is
   how Eigen's LDLT survives a rank-deficient system. */
function ldltSolve(Ain,b){
  const n=Ain.r, A=Ain.clone(), perm=new Int32Array(n);
  for(let i=0;i<n;i++)perm[i]=i;
  const D=vecZero(n);
  let maxD=0;
  for(let k=0;k<n;k++){
    let bi=k, best=-Infinity;
    for(let i=k;i<n;i++){ const a=A.d[i*n+i]; if(a>best){best=a;bi=i;} }
    if(bi!==k){
      for(let j=0;j<n;j++){ const t=A.d[k*n+j]; A.d[k*n+j]=A.d[bi*n+j]; A.d[bi*n+j]=t; }
      for(let i=0;i<n;i++){ const t=A.d[i*n+k]; A.d[i*n+k]=A.d[i*n+bi]; A.d[i*n+bi]=t; }
      const t=perm[k]; perm[k]=perm[bi]; perm[bi]=t;
    }
    let d=A.d[k*n+k];
    for(let j=0;j<k;j++)d-=A.d[k*n+j]*A.d[k*n+j]*D[j];
    D[k]=d;
    if(Math.abs(d)>maxD)maxD=Math.abs(d);
    if(!(Math.abs(d)>maxD*EPS_MACH*n)||!isFinite(d)){ D[k]=0; A.d[k*n+k]=1;
      for(let i=k+1;i<n;i++)A.d[i*n+k]=0; continue; }
    for(let i=k+1;i<n;i++){
      let s=A.d[i*n+k];
      for(let j=0;j<k;j++)s-=A.d[i*n+j]*A.d[k*n+j]*D[j];
      A.d[i*n+k]=s/d;
    }
    A.d[k*n+k]=1;
  }
  const y=vecZero(n);
  for(let i=0;i<n;i++){ let s=b[perm[i]]; for(let j=0;j<i;j++)s-=A.d[i*n+j]*y[j]; y[i]=s; }
  for(let i=0;i<n;i++)y[i]=(D[i]!==0)?y[i]/D[i]:0;
  const z=vecZero(n);
  for(let i=n-1;i>=0;i--){ let s=y[i]; for(let j=i+1;j<n;j++)s-=A.d[j*n+i]*z[j]; z[i]=s; }
  const x=vecZero(n);
  for(let i=0;i<n;i++)x[perm[i]]=z[i];
  return x;
}

/* ===================================================================== */
/* Geometry (Geo.h / Geo.cpp).  A parameter is an object {v:number}; its  */
/* identity does the work the C++ double* pointer did, so redirection and */
/* "is this parameter mine" tests are unchanged.                          */
/* ===================================================================== */

function param(v){ return {v:v||0}; }
function Point(x,y){ this.x=x; this.y=y; }
Point.prototype.pushOwnParams=function(pvec){ pvec.push(this.x); pvec.push(this.y); return 2; };
Point.prototype.reconstruct=function(pvec,cnt){ this.x=pvec[cnt.i++]; this.y=pvec[cnt.i++]; };
function Line(p1,p2){ this.p1=p1; this.p2=p2; }
Line.prototype.pushOwnParams=function(pvec){ return this.p1.pushOwnParams(pvec)+this.p2.pushOwnParams(pvec); };
Line.prototype.reconstruct=function(pvec,cnt){ this.p1.reconstruct(pvec,cnt); this.p2.reconstruct(pvec,cnt); };
function Circle(center,rad){ this.center=center; this.rad=rad; }
Circle.prototype.pushOwnParams=function(pvec){ const n=this.center.pushOwnParams(pvec); pvec.push(this.rad); return n+1; };
Circle.prototype.reconstruct=function(pvec,cnt){ this.center.reconstruct(pvec,cnt); this.rad=pvec[cnt.i++]; };

/* DeriVector2: a vector and its derivative with respect to whichever single
   parameter the gradient is being taken for.  Forward-mode differentiation
   done by hand — the reason the ported constraints are exact. */
function DeriVector2(x,y,dx,dy){ this.x=x; this.y=y; this.dx=dx||0; this.dy=dy||0; }
function dvFromPoint(p,dp){ return new DeriVector2(p.x.v,p.y.v,(dp===p.x)?1:0,(dp===p.y)?1:0); }
DeriVector2.prototype.length=function(){ return Math.sqrt(this.x*this.x+this.y*this.y); };
DeriVector2.prototype.lengthD=function(out){ const l=this.length();
  if(l===0){ out.d=1.0; return l; }
  out.d=(this.x*this.dx+this.y*this.dy)/l; return l; };
DeriVector2.prototype.getNormalized=function(){
  const l=this.length();
  if(l===0)return new DeriVector2(0,0,this.dx,this.dy);
  const rx=this.x/l, ry=this.y/l;
  let rdx=this.dx/l, rdy=this.dy/l;
  const dsc=rdx*rx+rdy*ry;                    // drop the collinear part
  rdx-=dsc*rx; rdy-=dsc*ry;
  return new DeriVector2(rx,ry,rdx,rdy); };
DeriVector2.prototype.scalarProd=function(v2,out){
  if(out)out.d=this.dx*v2.x+this.x*v2.dx+this.dy*v2.y+this.y*v2.dy;
  return this.x*v2.x+this.y*v2.y; };
DeriVector2.prototype.crossProdZ=function(v2,out){
  out.d=this.dx*v2.y+this.x*v2.dy-this.dy*v2.x-this.y*v2.dx;
  return this.x*v2.y-this.y*v2.x; };
DeriVector2.prototype.sum=function(v2){ return new DeriVector2(this.x+v2.x,this.y+v2.y,this.dx+v2.dx,this.dy+v2.dy); };
DeriVector2.prototype.subtr=function(v2){ return new DeriVector2(this.x-v2.x,this.y-v2.y,this.dx-v2.dx,this.dy-v2.dy); };
DeriVector2.prototype.mult=function(v){ return new DeriVector2(this.x*v,this.y*v,this.dx*v,this.dy*v); };
DeriVector2.prototype.rotate90ccw=function(){ return new DeriVector2(-this.y,this.x,-this.dy,this.dx); };

/* ===================================================================== */
/* Constraints (Constraints.h / Constraints.cpp)                          */
/* ===================================================================== */

const CT={None:0,Equal:1,Difference:2,P2PDistance:3,P2PAngle:4,P2LDistance:5,PointOnLine:6,
  PointOnPerpBisector:7,Parallel:8,Perpendicular:9,L2LAngle:10,MidpointOnLine:11,
  TangentCircumf:12,EqualLineLength:25,PolygonCorner:900};

const EG={err:0,grad:0};                       // scratch for errorgrad, single-threaded

function Constraint(){
  this.pvec=[]; this.origpvec=[]; this.scale=1; this.tag=0;
  this.driving=true; this.internalAlignment=false;
}
Constraint.prototype.typeId=function(){ return CT.None; };
Constraint.prototype.rescale=function(coef){ this.scale=(coef==null?1:coef)*1.0; };
Constraint.prototype.reconstructGeomPointers=function(){};
Constraint.prototype.redirectParams=function(map){
  for(let i=0;i<this.origpvec.length;i++){
    const t=map.get(this.origpvec[i]);
    if(t!==undefined)this.pvec[i]=t; else this.pvec[i]=this.origpvec[i];
  }
  this.reconstructGeomPointers();
};
Constraint.prototype.revertParams=function(){
  this.pvec=this.origpvec.slice(); this.reconstructGeomPointers();
};
Constraint.prototype.findParamInPvec=function(p){
  for(let i=0;i<this.pvec.length;i++) if(this.pvec[i]===p)return i;
  return -1;
};
Constraint.prototype.errorgrad=function(dp,out){ out.err=0; out.grad=0; };
Constraint.prototype.error=function(){ this.errorgrad(null,EG); return this.scale*EG.err; };
Constraint.prototype.grad=function(p){
  if(this.findParamInPvec(p)<0)return 0;
  this.errorgrad(p,EG);
  return EG.grad*this.scale;
};
Constraint.prototype.maxStep=function(dir,lim){ return lim; };
Constraint.prototype.params=function(){ return this.pvec; };
Constraint.prototype.setTag=function(t){ this.tag=t; return this; };
Constraint.prototype.getTag=function(){ return this.tag; };
Constraint.prototype.evaluate=function(){};

function extend(sub,type){
  sub.prototype=Object.create(Constraint.prototype);
  sub.prototype.constructor=sub;
  sub.prototype.typeId=function(){ return type; };
  return sub;
}

/* ---- Equal: param1 - ratio*param2 ------------------------------------ */
function ConstraintEqual(p1,p2,ratio){
  Constraint.call(this);
  this.ratio=(ratio==null)?1.0:ratio;
  this.pvec.push(p1); this.pvec.push(p2);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintEqual,CT.Equal);
ConstraintEqual.prototype.error=function(){ return this.scale*(this.pvec[0].v-this.ratio*this.pvec[1].v); };
ConstraintEqual.prototype.grad=function(p){
  let d=0;
  if(p===this.pvec[0])d+=1;
  // upstream returns -1 here; -ratio is the true derivative and matches for ratio=1
  if(p===this.pvec[1])d+=-this.ratio;
  return this.scale*d;
};
ConstraintEqual.prototype.evaluate=function(){ this.pvec[1].v=this.pvec[0].v/this.ratio; };

/* ---- Difference: (p2-p1) - difference -------------------------------- */
function ConstraintDifference(p1,p2,d){
  Constraint.call(this);
  this.pvec.push(p1); this.pvec.push(p2); this.pvec.push(d);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintDifference,CT.Difference);
ConstraintDifference.prototype.value=function(){ return this.pvec[1].v-this.pvec[0].v; };
ConstraintDifference.prototype.error=function(){ return this.scale*(this.value()-this.pvec[2].v); };
ConstraintDifference.prototype.grad=function(p){
  let d=0;
  if(p===this.pvec[0])d+=-1;
  if(p===this.pvec[1])d+=1;
  if(p===this.pvec[2])d+=-1;
  return this.scale*d;
};
ConstraintDifference.prototype.evaluate=function(){ this.pvec[2].v=this.scale*this.value(); };

/* ---- P2PDistance ------------------------------------------------------
   The residual is the plain sqrt distance minus the target, as upstream has
   it. A squared residual would have a derivative that is finite everywhere,
   where this one is singular at exactly zero separation — but it would also
   change the weighting of every over-constrained sketch, since squared lengths
   are not lengths. What keeps the sqrt safe is maxStep below, which refuses a
   step that would change the distance by more than the distance itself. */
function ConstraintP2PDistance(p1,p2,d){
  Constraint.call(this);
  this.pvec.push(p1.x); this.pvec.push(p1.y); this.pvec.push(p2.x); this.pvec.push(p2.y);
  this.pvec.push(d);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintP2PDistance,CT.P2PDistance);
ConstraintP2PDistance.prototype.value=function(){
  const dx=this.pvec[0].v-this.pvec[2].v, dy=this.pvec[1].v-this.pvec[3].v;
  return Math.sqrt(dx*dx+dy*dy);
};
ConstraintP2PDistance.prototype.error=function(){ return this.scale*(this.value()-this.pvec[4].v); };
ConstraintP2PDistance.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]){
    const dx=P[0].v-P[2].v, dy=P[1].v-P[3].v;
    const d=Math.sqrt(dx*dx+dy*dy);
    if(p===P[0])deriv+=dx/d;
    if(p===P[1])deriv+=dy/d;
    if(p===P[2])deriv+=-dx/d;
    if(p===P[3])deriv+=-dy/d;
  }
  if(p===P[4])deriv+=-1;
  return this.scale*deriv;
};
ConstraintP2PDistance.prototype.maxStep=function(dir,lim){
  const P=this.pvec;
  let it=dir.get(P[4]);
  if(it!==undefined&&it<0)lim=Math.min(lim,-P[4].v/it);
  let ddx=0,ddy=0;
  it=dir.get(P[0]); if(it!==undefined)ddx+=it;
  it=dir.get(P[1]); if(it!==undefined)ddy+=it;
  it=dir.get(P[2]); if(it!==undefined)ddx-=it;
  it=dir.get(P[3]); if(it!==undefined)ddy-=it;
  const dd=Math.sqrt(ddx*ddx+ddy*ddy), dist=P[4].v;
  if(dd>dist){
    const dx=P[0].v-P[2].v, dy=P[1].v-P[3].v, d=Math.sqrt(dx*dx+dy*dy);
    if(dd>d)lim=Math.min(lim,Math.max(d,dist)/dd);
  }
  return lim;
};
ConstraintP2PDistance.prototype.evaluate=function(){ this.pvec[4].v=this.value(); };

/* ---- P2PAngle: direction of p1->p2 against a target ------------------- */
function ConstraintP2PAngle(p1,p2,a,da){
  Constraint.call(this);
  this.da=da||0;
  this.pvec.push(p1.x); this.pvec.push(p1.y); this.pvec.push(p2.x); this.pvec.push(p2.y);
  this.pvec.push(a);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintP2PAngle,CT.P2PAngle);
ConstraintP2PAngle.prototype.error=function(){
  const P=this.pvec;
  const dx=P[2].v-P[0].v, dy=P[3].v-P[1].v;
  const a=P[4].v+this.da, ca=Math.cos(a), sa=Math.sin(a);
  const x=dx*ca+dy*sa, y=-dx*sa+dy*ca;
  return this.scale*Math.atan2(y,x);
};
ConstraintP2PAngle.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]){
    let dx=P[2].v-P[0].v, dy=P[3].v-P[1].v;
    const a=P[4].v+this.da, ca=Math.cos(a), sa=Math.sin(a);
    const x=dx*ca+dy*sa, y=-dx*sa+dy*ca;
    const r2=dx*dx+dy*dy;
    dx=-y/r2; dy=x/r2;
    if(p===P[0])deriv+=(-ca*dx+sa*dy);
    if(p===P[1])deriv+=(-sa*dx-ca*dy);
    if(p===P[2])deriv+=(ca*dx-sa*dy);
    if(p===P[3])deriv+=(sa*dx+ca*dy);
  }
  if(p===P[4])deriv+=-1;
  return this.scale*deriv;
};
ConstraintP2PAngle.prototype.maxStep=function(dir,lim){
  const it=dir.get(this.pvec[4]);
  if(it!==undefined){ const step=Math.abs(it); if(step>Math.PI/18)lim=Math.min(lim,(Math.PI/18)/step); }
  return lim;
};
ConstraintP2PAngle.prototype.evaluate=function(){
  const P=this.pvec;
  P[4].v=Math.atan2(P[3].v-P[1].v,P[2].v-P[0].v)-this.da;
};

/* ---- P2LDistance: signed distance point to line, driven to +-distance -
   The signed form is what makes tangency stable: ccw records which side the
   circle centre started on, so it cannot flip through the line mid-solve. */
function ConstraintP2LDistance(p,l,d,ccw){
  Constraint.call(this);
  this.ccw=!!ccw;
  this.pvec.push(p.x); this.pvec.push(p.y);
  this.pvec.push(l.p1.x); this.pvec.push(l.p1.y);
  this.pvec.push(l.p2.x); this.pvec.push(l.p2.y);
  this.pvec.push(d);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintP2LDistance,CT.P2LDistance);
ConstraintP2LDistance.prototype.signedValue=function(){
  const P=this.pvec;
  const x0=P[0].v,y0=P[1].v,x1=P[2].v,y1=P[3].v,x2=P[4].v,y2=P[5].v;
  const dx=x2-x1, dy=y2-y1;
  const d=Math.sqrt(dx*dx+dy*dy);
  const area=-x0*dy+y0*dx+x1*y2-x2*y1;
  return area/d;
};
ConstraintP2LDistance.prototype.value=function(){ return Math.abs(this.signedValue()); };
ConstraintP2LDistance.prototype.error=function(){
  const dist=this.ccw?Math.abs(this.pvec[6].v):-Math.abs(this.pvec[6].v);
  return this.scale*(this.signedValue()-dist);
};
ConstraintP2LDistance.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]||p===P[4]||p===P[5]){
    const x0=P[0].v,y0=P[1].v,x1=P[2].v,y1=P[3].v,x2=P[4].v,y2=P[5].v;
    const dx=x2-x1, dy=y2-y1;
    const d2=dx*dx+dy*dy, d=Math.sqrt(d2);
    const area=-x0*dy+y0*dx+x1*y2-x2*y1;
    if(p===P[0])deriv+=(y1-y2)/d;
    if(p===P[1])deriv+=(x2-x1)/d;
    if(p===P[2])deriv+=((y2-y0)*d+(dx/d)*area)/d2;
    if(p===P[3])deriv+=((x0-x2)*d+(dy/d)*area)/d2;
    if(p===P[4])deriv+=((y0-y1)*d-(dx/d)*area)/d2;
    if(p===P[5])deriv+=((x1-x0)*d-(dy/d)*area)/d2;
  }
  if(p===P[6])deriv+=this.ccw?-1:1;
  return this.scale*deriv;
};
ConstraintP2LDistance.prototype.maxStep=function(dir,lim){
  const P=this.pvec;
  let it=dir.get(P[6]);
  if(it!==undefined&&it<0)lim=Math.min(lim,-P[6].v/it);
  const x0=P[0].v,y0=P[1].v,x1=P[2].v,y1=P[3].v,x2=P[4].v,y2=P[5].v;
  let darea=0;
  it=dir.get(P[0]); if(it!==undefined)darea+=(y1-y2)*it;
  it=dir.get(P[1]); if(it!==undefined)darea+=(x2-x1)*it;
  it=dir.get(P[2]); if(it!==undefined)darea+=(y2-y0)*it;
  it=dir.get(P[3]); if(it!==undefined)darea+=(x0-x2)*it;
  it=dir.get(P[4]); if(it!==undefined)darea+=(y0-y1)*it;
  it=dir.get(P[5]); if(it!==undefined)darea+=(x1-x0)*it;
  darea=Math.abs(darea);
  if(darea>0){
    const dx=x2-x1, dy=y2-y1;
    let area=0.3*P[6].v*Math.sqrt(dx*dx+dy*dy);
    if(darea>area){
      area=Math.max(area,0.3*Math.abs(-x0*dy+y0*dx+x1*y2-x2*y1));
      if(darea>area)lim=Math.min(lim,area/darea);
    }
  }
  return lim;
};
ConstraintP2LDistance.prototype.evaluate=function(){ this.pvec[6].v=this.value(); };

/* ---- PointOnLine ----------------------------------------------------- */
function ConstraintPointOnLine(p,lp1,lp2){
  Constraint.call(this);
  this.pvec.push(p.x); this.pvec.push(p.y);
  this.pvec.push(lp1.x); this.pvec.push(lp1.y);
  this.pvec.push(lp2.x); this.pvec.push(lp2.y);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintPointOnLine,CT.PointOnLine);
ConstraintPointOnLine.prototype.error=function(){
  const P=this.pvec;
  const x0=P[0].v,y0=P[1].v,x1=P[2].v,y1=P[3].v,x2=P[4].v,y2=P[5].v;
  const dx=x2-x1, dy=y2-y1;
  const d=Math.sqrt(dx*dx+dy*dy);
  const area=-x0*dy+y0*dx+x1*y2-x2*y1;
  return this.scale*area/d;
};
ConstraintPointOnLine.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]||p===P[4]||p===P[5]){
    const x0=P[0].v,y0=P[1].v,x1=P[2].v,y1=P[3].v,x2=P[4].v,y2=P[5].v;
    const dx=x2-x1, dy=y2-y1;
    const d2=dx*dx+dy*dy, d=Math.sqrt(d2);
    const area=-x0*dy+y0*dx+x1*y2-x2*y1;
    if(p===P[0])deriv+=(y1-y2)/d;
    if(p===P[1])deriv+=(x2-x1)/d;
    if(p===P[2])deriv+=((y2-y0)*d+(dx/d)*area)/d2;
    if(p===P[3])deriv+=((x0-x2)*d+(dy/d)*area)/d2;
    if(p===P[4])deriv+=((y0-y1)*d-(dx/d)*area)/d2;
    if(p===P[5])deriv+=((x1-x0)*d-(dy/d)*area)/d2;
  }
  return this.scale*deriv;
};

/* ---- PointOnPerpBisector --------------------------------------------- */
function ConstraintPointOnPerpBisector(p,lp1,lp2){
  Constraint.call(this);
  this.pvec.push(p.x); this.pvec.push(p.y);
  this.pvec.push(lp1.x); this.pvec.push(lp1.y);
  this.pvec.push(lp2.x); this.pvec.push(lp2.y);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintPointOnPerpBisector,CT.PointOnPerpBisector);
ConstraintPointOnPerpBisector.prototype.errorgrad=function(dp,out){
  const P=this.pvec;
  const p0=new DeriVector2(P[0].v,P[1].v,(dp===P[0])?1:0,(dp===P[1])?1:0);
  const p1=new DeriVector2(P[2].v,P[3].v,(dp===P[2])?1:0,(dp===P[3])?1:0);
  const p2=new DeriVector2(P[4].v,P[5].v,(dp===P[4])?1:0,(dp===P[5])?1:0);
  const d1=p0.subtr(p1), d2=p0.subtr(p2);
  const D=p2.subtr(p1).getNormalized();
  const o1={d:0}, o2={d:0};
  const projd1=d1.scalarProd(D,o1);
  const projd2=d2.scalarProd(D,o2);
  out.err=projd1+projd2;
  out.grad=o1.d+o2.d;
};

/* ---- Parallel: the cross product of the two directions ---------------- */
function ConstraintParallel(l1,l2){
  Constraint.call(this);
  this.pvec.push(l1.p1.x); this.pvec.push(l1.p1.y); this.pvec.push(l1.p2.x); this.pvec.push(l1.p2.y);
  this.pvec.push(l2.p1.x); this.pvec.push(l2.p1.y); this.pvec.push(l2.p2.x); this.pvec.push(l2.p2.y);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintParallel,CT.Parallel);
/* rescale divides by both lengths, which turns a residual with units of area
   into the sine of the angle between them — the reason a long line and a short
   one are weighed the same. */
ConstraintParallel.prototype.rescale=function(coef){
  const P=this.pvec;
  const dx1=P[0].v-P[2].v, dy1=P[1].v-P[3].v, dx2=P[4].v-P[6].v, dy2=P[5].v-P[7].v;
  this.scale=(coef==null?1:coef)/Math.sqrt((dx1*dx1+dy1*dy1)*(dx2*dx2+dy2*dy2));
};
ConstraintParallel.prototype.error=function(){
  const P=this.pvec;
  const dx1=P[0].v-P[2].v, dy1=P[1].v-P[3].v, dx2=P[4].v-P[6].v, dy2=P[5].v-P[7].v;
  return this.scale*(dx1*dy2-dy1*dx2);
};
ConstraintParallel.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0])deriv+=(P[5].v-P[7].v);
  if(p===P[2])deriv+=-(P[5].v-P[7].v);
  if(p===P[1])deriv+=-(P[4].v-P[6].v);
  if(p===P[3])deriv+=(P[4].v-P[6].v);
  if(p===P[4])deriv+=-(P[1].v-P[3].v);
  if(p===P[6])deriv+=(P[1].v-P[3].v);
  if(p===P[5])deriv+=(P[0].v-P[2].v);
  if(p===P[7])deriv+=-(P[0].v-P[2].v);
  return this.scale*deriv;
};

/* ---- Perpendicular: the dot product of the two directions ------------- */
function ConstraintPerpendicular(l1p1,l1p2,l2p1,l2p2){
  Constraint.call(this);
  this.pvec.push(l1p1.x); this.pvec.push(l1p1.y); this.pvec.push(l1p2.x); this.pvec.push(l1p2.y);
  this.pvec.push(l2p1.x); this.pvec.push(l2p1.y); this.pvec.push(l2p2.x); this.pvec.push(l2p2.y);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintPerpendicular,CT.Perpendicular);
ConstraintPerpendicular.prototype.rescale=ConstraintParallel.prototype.rescale;
ConstraintPerpendicular.prototype.error=function(){
  const P=this.pvec;
  const dx1=P[0].v-P[2].v, dy1=P[1].v-P[3].v, dx2=P[4].v-P[6].v, dy2=P[5].v-P[7].v;
  return this.scale*(dx1*dx2+dy1*dy2);
};
ConstraintPerpendicular.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0])deriv+=(P[4].v-P[6].v);
  if(p===P[2])deriv+=-(P[4].v-P[6].v);
  if(p===P[1])deriv+=(P[5].v-P[7].v);
  if(p===P[3])deriv+=-(P[5].v-P[7].v);
  if(p===P[4])deriv+=(P[0].v-P[2].v);
  if(p===P[6])deriv+=-(P[0].v-P[2].v);
  if(p===P[5])deriv+=(P[1].v-P[3].v);
  if(p===P[7])deriv+=-(P[1].v-P[3].v);
  return this.scale*deriv;
};

/* ---- L2LAngle: angle from line 1 to line 2 ---------------------------- */
function ConstraintL2LAngle(l1p1,l1p2,l2p1,l2p2,a){
  Constraint.call(this);
  this.pvec.push(l1p1.x); this.pvec.push(l1p1.y); this.pvec.push(l1p2.x); this.pvec.push(l1p2.y);
  this.pvec.push(l2p1.x); this.pvec.push(l2p1.y); this.pvec.push(l2p2.x); this.pvec.push(l2p2.y);
  this.pvec.push(a);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintL2LAngle,CT.L2LAngle);
ConstraintL2LAngle.prototype.error=function(){
  const P=this.pvec;
  const dx1=P[2].v-P[0].v, dy1=P[3].v-P[1].v, dx2=P[6].v-P[4].v, dy2=P[7].v-P[5].v;
  const a=Math.atan2(dy1,dx1)+P[8].v, ca=Math.cos(a), sa=Math.sin(a);
  const x2=dx2*ca+dy2*sa, y2=-dx2*sa+dy2*ca;
  return this.scale*Math.atan2(y2,x2);
};
ConstraintL2LAngle.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]){
    const dx1=P[2].v-P[0].v, dy1=P[3].v-P[1].v;
    const r2=dx1*dx1+dy1*dy1;
    if(p===P[0])deriv+=-dy1/r2;
    if(p===P[1])deriv+=dx1/r2;
    if(p===P[2])deriv+=dy1/r2;
    if(p===P[3])deriv+=-dx1/r2;
  }
  if(p===P[4]||p===P[5]||p===P[6]||p===P[7]){
    const dx1=P[2].v-P[0].v, dy1=P[3].v-P[1].v;
    let dx2=P[6].v-P[4].v, dy2=P[7].v-P[5].v;
    const a=Math.atan2(dy1,dx1)+P[8].v, ca=Math.cos(a), sa=Math.sin(a);
    const x2=dx2*ca+dy2*sa, y2=-dx2*sa+dy2*ca;
    const r2=dx2*dx2+dy2*dy2;
    dx2=-y2/r2; dy2=x2/r2;
    if(p===P[4])deriv+=(-ca*dx2+sa*dy2);
    if(p===P[5])deriv+=(-sa*dx2-ca*dy2);
    if(p===P[6])deriv+=(ca*dx2-sa*dy2);
    if(p===P[7])deriv+=(sa*dx2+ca*dy2);
  }
  if(p===P[8])deriv+=-1;
  return this.scale*deriv;
};
ConstraintL2LAngle.prototype.maxStep=ConstraintP2PAngle.prototype.maxStep;
ConstraintL2LAngle.prototype.evaluate=function(){
  const P=this.pvec;
  const dx1=P[2].v-P[0].v, dy1=P[3].v-P[1].v, dx2=P[6].v-P[4].v, dy2=P[7].v-P[5].v;
  const a=Math.atan2(dy1,dx1), ca=Math.cos(a), sa=Math.sin(a);
  P[8].v=Math.atan2(-dx2*sa+dy2*ca,dx2*ca+dy2*sa);
};

/* ---- MidpointOnLine --------------------------------------------------- */
function ConstraintMidpointOnLine(l1p1,l1p2,l2p1,l2p2){
  Constraint.call(this);
  this.pvec.push(l1p1.x); this.pvec.push(l1p1.y); this.pvec.push(l1p2.x); this.pvec.push(l1p2.y);
  this.pvec.push(l2p1.x); this.pvec.push(l2p1.y); this.pvec.push(l2p2.x); this.pvec.push(l2p2.y);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintMidpointOnLine,CT.MidpointOnLine);
ConstraintMidpointOnLine.prototype.error=function(){
  const P=this.pvec;
  const x0=(P[0].v+P[2].v)/2, y0=(P[1].v+P[3].v)/2;
  const x1=P[4].v, x2=P[6].v, y1=P[5].v, y2=P[7].v;
  const dx=x2-x1, dy=y2-y1;
  const d=Math.sqrt(dx*dx+dy*dy);
  const area=-x0*dy+y0*dx+x1*y2-x2*y1;
  return this.scale*area/d;
};
ConstraintMidpointOnLine.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  const x0=(P[0].v+P[2].v)/2, y0=(P[1].v+P[3].v)/2;
  const x1=P[4].v, x2=P[6].v, y1=P[5].v, y2=P[7].v;
  const dx=x2-x1, dy=y2-y1;
  const d2=dx*dx+dy*dy, d=Math.sqrt(d2);
  const area=-x0*dy+y0*dx+x1*y2-x2*y1;
  if(p===P[0])deriv+=(y1-y2)/(2*d);
  if(p===P[1])deriv+=(x2-x1)/(2*d);
  if(p===P[2])deriv+=(y1-y2)/(2*d);
  if(p===P[3])deriv+=(x2-x1)/(2*d);
  if(p===P[4])deriv+=((y2-y0)*d+(dx/d)*area)/d2;
  if(p===P[5])deriv+=((x0-x2)*d+(dy/d)*area)/d2;
  if(p===P[6])deriv+=((y0-y1)*d-(dx/d)*area)/d2;
  if(p===P[7])deriv+=((x1-x0)*d-(dy/d)*area)/d2;
  return this.scale*deriv;
};

/* ---- TangentCircumf: circle to circle, inside or outside --------------- */
function ConstraintTangentCircumf(p1,p2,rad1,rad2,internal){
  Constraint.call(this);
  this.internal=!!internal;
  this.pvec.push(p1.x); this.pvec.push(p1.y); this.pvec.push(p2.x); this.pvec.push(p2.y);
  this.pvec.push(rad1); this.pvec.push(rad2);
  this.origpvec=this.pvec.slice(); this.rescale();
}
extend(ConstraintTangentCircumf,CT.TangentCircumf);
ConstraintTangentCircumf.prototype.error=function(){
  const P=this.pvec;
  const dx=P[0].v-P[2].v, dy=P[1].v-P[3].v, dSq=dx*dx+dy*dy;
  // near-concentric: tangency is equal radii, and that form has a gradient
  if(dSq<1e-14)return this.scale*(P[4].v-P[5].v);
  if(this.internal)return this.scale*(dSq-(P[4].v-P[5].v)*(P[4].v-P[5].v));
  return this.scale*(dSq-(P[4].v+P[5].v)*(P[4].v+P[5].v));
};
ConstraintTangentCircumf.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  if(p===P[0]||p===P[1]||p===P[2]||p===P[3]||p===P[4]||p===P[5]){
    const dx=P[0].v-P[2].v, dy=P[1].v-P[3].v, dSq=dx*dx+dy*dy;
    if(dSq<1e-14){
      if(p===P[4])deriv=1.0; else if(p===P[5])deriv=-1.0;
      return this.scale*deriv;
    }
    if(p===P[0])deriv+=2*dx;
    if(p===P[1])deriv+=2*dy;
    if(p===P[2])deriv+=2*-dx;
    if(p===P[3])deriv+=2*-dy;
    if(this.internal){
      if(p===P[4])deriv+=2*(P[5].v-P[4].v);
      if(p===P[5])deriv+=2*(P[4].v-P[5].v);
    } else {
      if(p===P[4])deriv+=-2*(P[4].v+P[5].v);
      if(p===P[5])deriv+=-2*(P[4].v+P[5].v);
    }
  }
  return this.scale*deriv;
};

/* ---- EqualLineLength -------------------------------------------------- */
function ConstraintEqualLineLength(l1,l2){
  Constraint.call(this);
  this.l1=new Line(new Point(l1.p1.x,l1.p1.y),new Point(l1.p2.x,l1.p2.y));
  this.l2=new Line(new Point(l2.p1.x,l2.p1.y),new Point(l2.p2.x,l2.p2.y));
  this.l1.pushOwnParams(this.pvec); this.l2.pushOwnParams(this.pvec);
  this.origpvec=this.pvec.slice();
  this.reconstructGeomPointers(); this.rescale();
}
extend(ConstraintEqualLineLength,CT.EqualLineLength);
ConstraintEqualLineLength.prototype.reconstructGeomPointers=function(){
  const cnt={i:0};
  this.l1.reconstruct(this.pvec,cnt); this.l2.reconstruct(this.pvec,cnt);
};
ConstraintEqualLineLength.prototype.errorgrad=function(dp,out){
  const p1=dvFromPoint(this.l1.p1,dp), p2=dvFromPoint(this.l1.p2,dp);
  const p3=dvFromPoint(this.l2.p1,dp), p4=dvFromPoint(this.l2.p2,dp);
  const v1=p1.subtr(p2), v2=p3.subtr(p4);
  const o1={d:0}, o2={d:0};
  v1.lengthD(o1); v2.lengthD(o2);
  out.err=v2.length()-v1.length();
  let g=o2.d-o1.d;
  /* A horizontal or vertical line makes one of these derivatives vanish, and a
     zero row would read as an unconstrained parameter in the diagnosis. Keep a
     token 1e-10 with the right sign so the rank count stays honest. */
  if(Math.abs(g)<1e-10){
    const s=1e-10;
    if(dp===this.l1.p1.x)g=v1.x>0?s:-s;
    if(dp===this.l1.p1.y)g=v1.y>0?s:-s;
    if(dp===this.l1.p2.x)g=v1.x>0?-s:s;
    if(dp===this.l1.p2.y)g=v1.y>0?-s:s;
    if(dp===this.l2.p1.x)g=v2.x>0?s:-s;
    if(dp===this.l2.p1.y)g=v2.y>0?s:-s;
    if(dp===this.l2.p2.x)g=v2.x>0?-s:s;
    if(dp===this.l2.p2.y)g=v2.y>0?-s:s;
  }
  out.grad=g;
};

/* ---- PolygonCorner (freyacad, not upstream) ---------------------------
   freyacad stores a regular polygon as centre, circumradius and rotation —
   four numbers, whatever the side count.  Its corners are therefore not
   parameters but functions of those four, and no upstream primitive says so.
   This is the same device upstream uses for an ellipse's focus: give the
   corner two auxiliary parameters and pin them with two internal-alignment
   equations, one per coordinate.  Two parameters against two equations that
   are always independent, so the polygon keeps exactly its four degrees of
   freedom and the diagnosis counts it as the reduced shape it is.
       err_x = px - cx - r*cos(rot + k*2*pi/n)
       err_y = py - cy - r*sin(rot + k*2*pi/n)                             */
function ConstraintPolygonCorner(coord,pcoord,ccoord,rad,rot,k,n){
  Constraint.call(this);
  this.isY=(coord===1);
  this.k=k; this.n=n;
  this.pvec.push(pcoord); this.pvec.push(ccoord); this.pvec.push(rad); this.pvec.push(rot);
  this.origpvec=this.pvec.slice();
  this.internalAlignment=true;
  this.rescale();
}
extend(ConstraintPolygonCorner,CT.PolygonCorner);
ConstraintPolygonCorner.prototype.angle=function(){
  return this.pvec[3].v+this.k/this.n*Math.PI*2;
};
ConstraintPolygonCorner.prototype.error=function(){
  const P=this.pvec, a=this.angle();
  const t=this.isY?Math.sin(a):Math.cos(a);
  return this.scale*(P[0].v-P[1].v-P[2].v*t);
};
ConstraintPolygonCorner.prototype.grad=function(p){
  const P=this.pvec; let deriv=0;
  const a=this.angle();
  const c=Math.cos(a), s=Math.sin(a);
  if(p===P[0])deriv+=1;
  if(p===P[1])deriv+=-1;
  if(p===P[2])deriv+=this.isY?-s:-c;
  if(p===P[3])deriv+=this.isY?-P[2].v*c:P[2].v*s;
  return this.scale*deriv;
};

/* ===================================================================== */
/* SubSystem (SubSystem.cpp): a slice of the problem — some constraints   */
/* and the parameters they touch — working on its own copy of the values, */
/* so a rejected step costs nothing.                                      */
/* ===================================================================== */

function SubSystem(clist,params,reductionmap){
  this.clist=clist.slice();
  this.csize=this.clist.length;
  this.initialize(params,reductionmap||null);
}
SubSystem.prototype.initialize=function(params,reductionmap){
  // parameters of `params` that some constraint of this subsystem touches,
  // kept in the caller's order (upstream sorts by pointer; order only decides
  // column order, and this one is the same on every run)
  const touched=new Set();
  for(const c of this.clist){ c.revertParams(); for(const p of c.pvec)touched.add(p); }
  const tmpplist=[];
  for(const p of params) if(touched.has(p))tmpplist.push(p);

  this.plist=[];
  const rindex=new Map();
  if(reductionmap&&reductionmap.size){
    let i=0;
    const pindex=new Map();
    for(const p of tmpplist){
      const tgt=reductionmap.get(p);
      if(tgt!==undefined){
        const at=pindex.get(tgt);
        if(at===undefined){ this.plist.push(tgt); rindex.set(p,i); pindex.set(tgt,i); i++; }
        else rindex.set(p,at);
      } else if(!pindex.has(p)){ this.plist.push(p); pindex.set(p,i); i++; }
    }
  } else this.plist=tmpplist;

  this.psize=this.plist.length;
  this.pvals=new Array(this.psize);
  for(let j=0;j<this.psize;j++)this.pvals[j]={v:this.plist[j].v};
  /* Order matters here, and upstream leaves it to std::map's pointer ordering.
     redirectParams copies each original parameter into its local, so whichever
     of a merged pair is written LAST decides where the merged variable starts.
     Putting the eliminated parameters first and the kept ones last makes the
     kept one win, every time: the second point of a coincidence moves onto the
     first, which is the convention the rest of freyacad already follows. */
  this.pmap=new Map();
  for(const e of rindex) this.pmap.set(e[0],this.pvals[e[1]]);
  for(let j=0;j<this.psize;j++) this.pmap.set(this.plist[j],this.pvals[j]);

  this.p2c=new Map();
  for(const c of this.clist){
    c.revertParams();
    const seen=new Set();
    for(const p of c.pvec){
      const local=this.pmap.get(p);
      if(local===undefined||seen.has(local))continue;
      seen.add(local);
      let l=this.p2c.get(local); if(!l){ l=[]; this.p2c.set(local,l); }
      l.push(c);
    }
  }
  this._idxCache=null; this._idxKey=null;
};
SubSystem.prototype.pSize=function(){ return this.psize; };
SubSystem.prototype.cSize=function(){ return this.csize; };
SubSystem.prototype.redirectParams=function(){
  for(const e of this.pmap) e[1].v=e[0].v;
  for(const c of this.clist){ c.revertParams(); c.redirectParams(this.pmap); }
};
SubSystem.prototype.revertParams=function(){ for(const c of this.clist)c.revertParams(); };
SubSystem.prototype.getParamList=function(){ return this.plist.slice(); };
SubSystem.prototype.getParams=function(params,x){
  if(params===null){ for(let i=0;i<this.psize;i++)x[i]=this.pvals[i].v; return x; }
  for(let j=0;j<params.length;j++){ const l=this.pmap.get(params[j]); if(l!==undefined)x[j]=l.v; }
  return x;
};
SubSystem.prototype.setParams=function(params,x){
  if(params===null){ for(let i=0;i<this.psize;i++)this.pvals[i].v=x[i]; return; }
  for(let j=0;j<params.length;j++){ const l=this.pmap.get(params[j]); if(l!==undefined)l.v=x[j]; }
};
SubSystem.prototype.error=function(){
  let err=0;
  for(const c of this.clist){ const t=c.error(); err+=t*t; }
  return err*0.5;
};
SubSystem.prototype.calcResidual=function(r,out){
  let err=0;
  for(let i=0;i<this.csize;i++){ r[i]=this.clist[i].error(); err+=r[i]*r[i]; }
  if(out)out.err=err*0.5;
  return r;
};
SubSystem.prototype._index=function(params){
  if(this._idxKey===params&&this._idxCache)return this._idxCache;
  const m=new Map();
  for(let j=0;j<params.length;j++){ const l=this.pmap.get(params[j]); if(l!==undefined)m.set(l,j); }
  this._idxKey=params; this._idxCache=m;
  return m;
};
SubSystem.prototype.calcJacobi=function(params,J){
  const ps=(params===null)?this.plist:params;
  const idx=this._index(ps);
  J.zero();
  for(let i=0;i<this.csize;i++){
    const c=this.clist[i];
    for(const p of c.pvec){
      const j=idx.get(p);
      if(j===undefined)continue;
      J.set(i,j,c.grad(p));
    }
  }
  return J;
};
SubSystem.prototype.calcGrad=function(params,grad){
  const ps=(params===null)?this.plist:params;
  grad.fill(0);
  for(let j=0;j<ps.length;j++){
    const local=this.pmap.get(ps[j]);
    if(local===undefined)continue;
    const cs=this.p2c.get(local);
    if(!cs)continue;
    let s=0;
    for(const c of cs)s+=c.error()*c.grad(local);
    grad[j]=s;
  }
  return grad;
};
SubSystem.prototype.maxStep=function(params,xdir){
  const ps=(params===null)?this.plist:params;
  const dir=new Map();
  for(let j=0;j<ps.length;j++){ const l=this.pmap.get(ps[j]); if(l!==undefined)dir.set(l,xdir[j]); }
  let alpha=1e10;
  for(const c of this.clist)alpha=c.maxStep(dir,alpha);
  return alpha;
};
SubSystem.prototype.applySolution=function(){ for(const e of this.pmap)e[0].v=e[1].v; };

/* Quadratic line search over the subsystem error, upstream's lineSearch. */
function lineSearch(subsys,xdir){
  const alphaMax=subsys.maxStep(null,xdir);
  const x0=vecZero(subsys.pSize()), x=vecZero(subsys.pSize());
  subsys.getParams(null,x0);
  let alpha1=0, f1=subsys.error();
  let alpha2=1;
  for(let i=0;i<x0.length;i++)x[i]=x0[i]+alpha2*xdir[i];
  subsys.setParams(null,x);
  let f2=subsys.error();
  let alpha3=alpha2*2;
  for(let i=0;i<x0.length;i++)x[i]=x0[i]+alpha3*xdir[i];
  subsys.setParams(null,x);
  let f3=subsys.error();
  let guard=0;
  while((f2>f1||f2>f3)&&guard++<1000){
    if(f2>f1){
      alpha3=alpha2; f3=f2; alpha2=alpha2/2;
      for(let i=0;i<x0.length;i++)x[i]=x0[i]+alpha2*xdir[i];
      subsys.setParams(null,x); f2=subsys.error();
    } else if(f2>f3){
      if(alpha3>=alphaMax)break;
      alpha2=alpha3; f2=f3; alpha3=alpha3*2;
      for(let i=0;i<x0.length;i++)x[i]=x0[i]+alpha3*xdir[i];
      subsys.setParams(null,x); f3=subsys.error();
    }
  }
  let alphaStar=alpha2+((alpha2-alpha1)*(f1-f3))/(3*(f1-2*f2+f3));
  if(alphaStar>=alpha3||alphaStar<=alpha1)alphaStar=alpha2;
  if(alphaStar>alphaMax)alphaStar=alphaMax;
  if(alphaStar!==alphaStar)alphaStar=0;
  for(let i=0;i<x0.length;i++)x[i]=x0[i]+alphaStar*xdir[i];
  subsys.setParams(null,x);
  return alphaStar;
}

/* minimise 0.5*x'Hx + g'x subject to A*x + c = 0 (qp_eq.cpp).  Returns the
   step in x, the row space of A in Y and its null space in Z. */
function qp_eq(H,g,A,c,out){
  const AT=matTranspose(A);
  const qrAT=new FullPivQR(AT);
  const paramsNum=qrAT.m, constrNum=qrAT.n;
  const rank=qrAT.rank(null);
  if(rank!==constrNum||constrNum>paramsNum)return -1;
  const Q=qrAT.matrixQ();
  // Y = Q1 * inv(R1') * P'
  const Y=new Mat(paramsNum,constrNum);
  const qr=qrAT.qr, n=qrAT.n;
  const z=vecZero(constrNum);
  for(let i=0;i<paramsNum;i++){
    for(let k=constrNum-1;k>=0;k--){
      let s=Q.get(i,k);
      for(let j=k+1;j<constrNum;j++)s-=qr.d[k*n+j]*z[j];
      z[k]=s/qr.d[k*n+k];
    }
    for(let k=0;k<constrNum;k++)Y.set(i,qrAT.colPerm[k],z[k]);
  }
  out.Y=Y;
  const x=vecZero(paramsNum);
  const Yc=matVec(Y,c);
  if(paramsNum===rank){
    for(let i=0;i<paramsNum;i++)x[i]=-Yc[i];
    out.Z=new Mat(paramsNum,0);
  } else {
    const zc=paramsNum-rank;
    const Z=new Mat(paramsNum,zc);
    for(let i=0;i<paramsNum;i++)for(let j=0;j<zc;j++)Z.set(i,j,Q.get(i,rank+j));
    out.Z=Z;
    const HZ=matMul(H,Z), ZTHZ=matTMul(Z,HZ);
    const HYc=matVec(H,Yc);
    const rhsv=vecZero(paramsNum);
    for(let i=0;i<paramsNum;i++)rhsv[i]=HYc[i]-g[i];
    const rhs=matTVec(Z,rhsv);
    const y=new FullPivQR(ZTHZ).solve(rhs,null);
    const Zy=matVec(Z,y);
    for(let i=0;i<paramsNum;i++)x[i]=-Yc[i]+Zy[i];
  }
  out.x=x;
  return 0;
}

/* ===================================================================== */
/* System (GCS.cpp): the whole problem, its partitioning, its solvers and */
/* its diagnosis.                                                         */
/* ===================================================================== */

const SolveStatus={Success:0,Converged:1,Failed:2};
const Algorithm={BFGS:0,LevenbergMarquardt:1,DogLeg:2};
const DogLegGaussStep={LeastNormFullPivLU:1,LeastNormLdlt:2};
const XconvergenceRough=1e-8, smallF=1e-20;

function System(){
  this.plist=[]; this.pdrivenlist=[]; this.pIndex=new Map();
  this.pDependentParameters=[]; this.pDependentParametersGroups=[];
  this.clist=[]; this.drivenConstraints=[];
  this.subSystems=[]; this.subSystemsAux=[]; this.reductionmaps=[];
  this.plists=[]; this.clists=[];
  this.reference=[];
  this.dofs=0;
  this.redundant=new Set();
  this.conflictingTags=[]; this.redundantTags=[]; this.partiallyRedundantTags=[];
  this.hasUnknowns=false; this.hasDiagnosis=false; this.isInit=false;
  this.emptyDiagnoseMatrix=true;
  this.maxIter=100; this.maxIterRedundant=100;
  this.sketchSizeMultiplier=false; this.sketchSizeMultiplierRedundant=false;
  this.convergence=1e-10; this.convergenceRedundant=1e-10;
  /* Upstream defaults to FullPivLU on the rectangular Jacobian; this port
     defaults to the least-norm LDLT step, which upstream also implements.
     It is the step that moves the sketch as little as the constraints allow,
     and it needs only square factorisations. */
  this.dogLegGaussStep=DogLegGaussStep.LeastNormLdlt;
  this.qrpivotThreshold=1e-13;
  this.computeDependentParameters=true;
  /* Not upstream: skip the constrained SQP and solve the drag constraints
     alongside the real ones. Loses the strict priority between them, and is
     an order of magnitude cheaper on a big single component — see
     gcsSolve's pinMode. */
  this.preferMergedAux=false;
  this.LM_eps=1e-10; this.LM_eps1=1e-80; this.LM_tau=1e-3;
  this.DL_tolg=1e-80; this.DL_tolx=1e-80; this.DL_tolf=1e-10;
  this.LM_epsRedundant=1e-10; this.LM_eps1Redundant=1e-80; this.LM_tauRedundant=1e-3;
  this.DL_tolgRedundant=1e-80; this.DL_tolxRedundant=1e-80; this.DL_tolfRedundant=1e-10;
}

System.prototype.clear=function(){
  this.plist=[]; this.pdrivenlist=[]; this.pIndex=new Map();
  this.pDependentParameters=[]; this.pDependentParametersGroups=[];
  this.hasUnknowns=false; this.hasDiagnosis=false; this.emptyDiagnoseMatrix=true;
  this.redundant=new Set();
  this.conflictingTags=[]; this.redundantTags=[]; this.partiallyRedundantTags=[];
  this.reference=[]; this.clearSubSystems();
  this.clist=[]; this.drivenConstraints=[];
};
System.prototype.clearSubSystems=function(){
  this.isInit=false; this.subSystems=[]; this.subSystemsAux=[];
};
System.prototype.invalidatedDiagnosis=function(){
  this.hasDiagnosis=false; this.pDependentParameters=[]; this.pDependentParametersGroups=[];
};
System.prototype.addConstraint=function(c){
  this.isInit=false;
  if(c.getTag()>=0)this.hasDiagnosis=false;
  if(!c.driving)this.drivenConstraints.push(c);
  this.clist.push(c);
  return this.clist.length-1;
};
System.prototype.clearByTag=function(tagId){
  const keep=[];
  for(const c of this.clist){ if(c.getTag()===tagId){ this.isInit=false; continue; } keep.push(c); }
  this.clist=keep;
  this.drivenConstraints=this.drivenConstraints.filter(c=>c.getTag()!==tagId);
};
System.prototype.declareUnknowns=function(params){
  this.plist=params.slice();
  this.pIndex=new Map();
  for(let i=0;i<this.plist.length;i++)this.pIndex.set(this.plist[i],i);
  this.hasUnknowns=true;
};
System.prototype.declareDrivenParams=function(params){ this.pdrivenlist=params.slice(); };
System.prototype.setReference=function(){ this.reference=this.plist.map(p=>p.v); };
System.prototype.resetToReference=function(){
  if(this.reference.length===this.plist.length)
    for(let i=0;i<this.plist.length;i++)this.plist[i].v=this.reference[i];
};

/* ---- constraint builders (System::addConstraint* in GCS.cpp) ---------- */
function tagged(sys,c,tagId,driving,internal){
  c.setTag(tagId||0);
  c.driving=(driving===undefined)?true:!!driving;
  if(internal)c.internalAlignment=true;
  return sys.addConstraint(c);
}
System.prototype.addConstraintEqual=function(p1,p2,tagId,driving,internal){
  return tagged(this,new ConstraintEqual(p1,p2),tagId,driving,internal); };
System.prototype.addConstraintProportional=function(p1,p2,ratio,tagId,driving){
  return tagged(this,new ConstraintEqual(p1,p2,ratio),tagId,driving); };
System.prototype.addConstraintDifference=function(p1,p2,d,tagId,driving){
  return tagged(this,new ConstraintDifference(p1,p2,d),tagId,driving); };
System.prototype.addConstraintP2PDistance=function(p1,p2,d,tagId,driving){
  return tagged(this,new ConstraintP2PDistance(p1,p2,d),tagId,driving); };
System.prototype.addConstraintP2PAngle=function(p1,p2,a,da,tagId,driving){
  return tagged(this,new ConstraintP2PAngle(p1,p2,a,da),tagId,driving); };
System.prototype.addConstraintP2LDistance=function(p,l,d,ccw,tagId,driving){
  return tagged(this,new ConstraintP2LDistance(p,l,d,ccw),tagId,driving); };
System.prototype.addConstraintPointOnLine=function(p,lp1,lp2,tagId,driving){
  return tagged(this,new ConstraintPointOnLine(p,lp1,lp2),tagId,driving); };
System.prototype.addConstraintPointOnPerpBisector=function(p,lp1,lp2,tagId,driving){
  return tagged(this,new ConstraintPointOnPerpBisector(p,lp1,lp2),tagId,driving); };
System.prototype.addConstraintParallel=function(l1,l2,tagId,driving){
  return tagged(this,new ConstraintParallel(l1,l2),tagId,driving); };
System.prototype.addConstraintPerpendicular=function(l1p1,l1p2,l2p1,l2p2,tagId,driving){
  return tagged(this,new ConstraintPerpendicular(l1p1,l1p2,l2p1,l2p2),tagId,driving); };
System.prototype.addConstraintL2LAngle=function(l1p1,l1p2,l2p1,l2p2,a,tagId,driving){
  return tagged(this,new ConstraintL2LAngle(l1p1,l1p2,l2p1,l2p2,a),tagId,driving); };
System.prototype.addConstraintMidpointOnLine=function(l1p1,l1p2,l2p1,l2p2,tagId,driving){
  return tagged(this,new ConstraintMidpointOnLine(l1p1,l1p2,l2p1,l2p2),tagId,driving); };
System.prototype.addConstraintTangentCircumf=function(p1,p2,rd1,rd2,internal,tagId,driving){
  return tagged(this,new ConstraintTangentCircumf(p1,p2,rd1,rd2,internal),tagId,driving); };
System.prototype.addConstraintEqualLength=function(l1,l2,tagId,driving){
  return tagged(this,new ConstraintEqualLineLength(l1,l2),tagId,driving); };
System.prototype.addConstraintPolygonCorner=function(coord,pc,cc,rad,rot,k,n,tagId){
  return tagged(this,new ConstraintPolygonCorner(coord,pc,cc,rad,rot,k,n),tagId,true,true); };
// derived
System.prototype.addConstraintP2PCoincident=function(p1,p2,tagId,driving){
  this.addConstraintEqual(p1.x,p2.x,tagId,driving);
  return this.addConstraintEqual(p1.y,p2.y,tagId,driving); };
System.prototype.addConstraintHorizontal=function(p1,p2,tagId,driving){
  return this.addConstraintEqual(p1.y,p2.y,tagId,driving); };
System.prototype.addConstraintVertical=function(p1,p2,tagId,driving){
  return this.addConstraintEqual(p1.x,p2.x,tagId,driving); };
System.prototype.addConstraintCoordinateX=function(p,x,tagId,driving){
  return this.addConstraintEqual(p.x,x,tagId,driving); };
System.prototype.addConstraintCoordinateY=function(p,y,tagId,driving){
  return this.addConstraintEqual(p.y,y,tagId,driving); };
System.prototype.addConstraintPointOnCircle=function(p,c,tagId,driving){
  return this.addConstraintP2PDistance(p,c.center,c.rad,tagId,driving); };
System.prototype.addConstraintTangentLineCircle=function(l,c,ccw,tagId,driving){
  return this.addConstraintP2LDistance(c.center,l,c.rad,ccw,tagId,driving); };
System.prototype.addConstraintTangentCircles=function(c1,c2,tagId,driving){
  const dx=c2.center.x.v-c1.center.x.v, dy=c2.center.y.v-c1.center.y.v;
  const d=Math.sqrt(dx*dx+dy*dy);
  return this.addConstraintTangentCircumf(c1.center,c2.center,c1.rad,c2.rad,
    (d<c1.rad.v||d<c2.rad.v),tagId,driving); };
System.prototype.addConstraintCircleRadius=function(c,radius,tagId,driving){
  return this.addConstraintEqual(c.rad,radius,tagId,driving); };
System.prototype.addConstraintCircleDiameter=function(c,diameter,tagId,driving){
  return this.addConstraintProportional(c.rad,diameter,0.5,tagId,driving); };
System.prototype.addConstraintEqualRadius=function(c1,c2,tagId,driving){
  return this.addConstraintEqual(c1.rad,c2.rad,tagId,driving); };
System.prototype.addConstraintP2PSymmetric=function(p1,p2,l,tagId,driving){
  this.addConstraintPerpendicular(p1,p2,l.p1,l.p2,tagId,driving);
  return this.addConstraintMidpointOnLine(p1,p2,l.p1,l.p2,tagId,driving); };
System.prototype.addConstraintP2PSymmetricPoint=function(p1,p2,p,tagId,driving){
  this.addConstraintPointOnPerpBisector(p,p1,p2,tagId,driving);
  return this.addConstraintPointOnLine(p,p1,p2,tagId,driving); };

/* ---- partitioning (System::initSolution) ------------------------------ */
System.prototype.initSolution=function(alg){
  this.isInit=false;
  if(!this.hasUnknowns)return;
  this.setReference();
  if(!this.hasDiagnosis)this.diagnose(alg==null?Algorithm.DogLeg:alg);
  if(!this.hasDiagnosis)return;

  const clistR=this.clist.filter(c=>c.driving&&!this.redundant.has(c));

  // decoupled components over the parameter/constraint graph (union-find here,
  // Boost connected_components upstream)
  const np=this.plist.length, nv=np+clistR.length;
  const par=new Int32Array(nv);
  for(let i=0;i<nv;i++)par[i]=i;
  const find=(a)=>{ while(par[a]!==a){ par[a]=par[par[a]]; a=par[a]; } return a; };
  const uni=(a,b)=>{ a=find(a); b=find(b); if(a!==b)par[b]=a; };
  for(let ci=0;ci<clistR.length;ci++){
    for(const p of clistR[ci].pvec){
      const pi=this.pIndex.get(p);
      if(pi!==undefined)uni(np+ci,pi);
    }
  }
  const compId=new Map(); const components=new Int32Array(nv);
  let componentsSize=0;
  for(let i=0;i<nv;i++){
    const r=find(i);
    let id=compId.get(r);
    if(id===undefined){ id=componentsSize++; compId.set(r,id); }
    components[i]=id;
  }

  // equality reduction: an Equal between two unknowns merges them
  const reducedConstrs=new Set();
  this.reductionmaps=[];
  for(let i=0;i<componentsSize;i++)this.reductionmaps.push(new Map());
  {
    const reducedParams=this.plist.slice();
    for(const c of clistR){
      if(!(c.getTag()>=0&&c.typeId()===CT.Equal))continue;
      if(c.ratio!==1)continue;                 // a ratio is not a plain merge
      const i1=this.pIndex.get(c.pvec[0]), i2=this.pIndex.get(c.pvec[1]);
      if(i1===undefined||i2===undefined)continue;
      reducedConstrs.add(c);
      const kept=reducedParams[i1], replaced=reducedParams[i2];
      if(kept===replaced)continue;
      for(let k=0;k<reducedParams.length;k++)
        if(reducedParams[k]===replaced)reducedParams[k]=kept;
    }
    for(let i=0;i<this.plist.length;i++)
      if(this.plist[i]!==reducedParams[i])
        this.reductionmaps[components[i]].set(this.plist[i],reducedParams[i]);
  }

  this.clists=[]; this.plists=[];
  for(let i=0;i<componentsSize;i++){ this.clists.push([]); this.plists.push([]); }
  for(let ci=0;ci<clistR.length;ci++)
    if(!reducedConstrs.has(clistR[ci]))this.clists[components[np+ci]].push(clistR[ci]);
  for(let i=0;i<this.plist.length;i++)this.plists[components[i]].push(this.plist[i]);

  this.clearSubSystems();
  this.subSystems=new Array(componentsSize).fill(null);
  this.subSystemsAux=new Array(componentsSize).fill(null);
  for(let cid=0;cid<componentsSize;cid++){
    const c0=[], c1=[];
    for(const c of this.clists[cid])(c.getTag()>=0?c0:c1).push(c);
    if(c0.length)this.subSystems[cid]=new SubSystem(c0,this.plists[cid],this.reductionmaps[cid]);
    if(c1.length)this.subSystemsAux[cid]=new SubSystem(c1,this.plists[cid],this.reductionmaps[cid]);
  }
  this.isInit=true;
};

System.prototype.applySolution=function(){
  for(let cid=0;cid<this.subSystems.length;cid++){
    if(this.subSystemsAux[cid])this.subSystemsAux[cid].applySolution();
    if(this.subSystems[cid])this.subSystems[cid].applySolution();
    for(const e of this.reductionmaps[cid])e[0].v=e[1].v;
  }
  this.evaluateDrivenConstraints();
};
System.prototype.evaluateDrivenConstraints=function(){
  for(const c of this.drivenConstraints)c.evaluate();
};

/* ---- solve ------------------------------------------------------------ */
System.prototype.solve=function(isFine,alg,isRedundantsolving){
  if(!this.isInit)return SolveStatus.Failed;
  if(alg==null)alg=Algorithm.DogLeg;
  let isReset=false, res=SolveStatus.Success;
  for(let cid=0;cid<this.subSystems.length;cid++){
    if((this.subSystems[cid]||this.subSystemsAux[cid])&&!isReset){ this.resetToReference(); isReset=true; }
    if(this.subSystems[cid]&&this.subSystemsAux[cid]){
      let r=this.preferMergedAux?SolveStatus.Failed
           :this.solveAB(this.subSystems[cid],this.subSystemsAux[cid],isFine,isRedundantsolving);
      /* Not upstream: the SQP step needs the main subsystem's constraints to be
         independent, and refuses outright when they are not.  Rather than let a
         drag do nothing at all, fall back to solving both sets together, which
         costs the priority between them but still moves the sketch. */
      if(r===SolveStatus.Failed){
        const both=this.clists[cid].slice();
        const sub=new SubSystem(both,this.plists[cid],this.reductionmaps[cid]);
        r=this.solveSub(sub,isFine,alg,isRedundantsolving);
        sub.applySolution();
        // keep the two subsystems' working copies in step, so the later
        // applySolution() does not undo what the fallback just wrote
        for(const ss of [this.subSystems[cid],this.subSystemsAux[cid]])
          if(ss)for(const e of ss.pmap)e[1].v=e[0].v;
      }
      res=Math.max(res,r);
    }
    else if(this.subSystems[cid])
      res=Math.max(res,this.solveSub(this.subSystems[cid],isFine,alg,isRedundantsolving));
    else if(this.subSystemsAux[cid])
      res=Math.max(res,this.solveSub(this.subSystemsAux[cid],isFine,alg,isRedundantsolving));
  }
  if(res===SolveStatus.Success){
    for(const c of this.redundant){
      const err=c.error();
      if(err*err>(isRedundantsolving?this.convergenceRedundant:this.convergence))
        return SolveStatus.Converged;
    }
  }
  return res;
};
System.prototype.solveSub=function(subsys,isFine,alg,isRedundantsolving){
  if(alg===Algorithm.BFGS)return this.solve_BFGS(subsys,isFine,isRedundantsolving);
  if(alg===Algorithm.LevenbergMarquardt)return this.solve_LM(subsys,isRedundantsolving);
  if(alg===Algorithm.DogLeg)return this.solve_DL(subsys,isRedundantsolving);
  return SolveStatus.Failed;
};

System.prototype.solve_BFGS=function(subsys,isFine,isRedundantsolving){
  const xsize=subsys.pSize();
  if(xsize===0)return SolveStatus.Success;
  subsys.redirectParams();
  let D=matIdentity(xsize);
  let x=vecZero(xsize), xdir=vecZero(xsize), grad=vecZero(xsize), h=vecZero(xsize), y=vecZero(xsize);
  subsys.getParams(null,x);
  subsys.calcGrad(null,grad);
  for(let i=0;i<xsize;i++)xdir[i]=-grad[i];
  lineSearch(subsys,xdir);
  let err=subsys.error();
  for(let i=0;i<xsize;i++)h[i]=x[i];
  subsys.getParams(null,x);
  for(let i=0;i<xsize;i++)h[i]=x[i]-h[i];
  const maxIterNumber=(isRedundantsolving
    ?(this.sketchSizeMultiplierRedundant?this.maxIterRedundant*xsize:this.maxIterRedundant)
    :(this.sketchSizeMultiplier?this.maxIter*xsize:this.maxIter));
  const convCriterion=isRedundantsolving?this.convergenceRedundant:this.convergence;
  const divergingLim=1e6*err+1e12;
  let iters=0;
  for(let iter=1;iter<maxIterNumber;iter++){
    iters=iter;
    const hnorm=vecNorm(h);
    if(hnorm<=convCriterion||err<=smallF)break;
    if(err>divergingLim||err!==err)break;
    for(let i=0;i<xsize;i++)y[i]=grad[i];
    subsys.calcGrad(null,grad);
    for(let i=0;i<xsize;i++)y[i]=grad[i]-y[i];
    let hty=vecDot(h,y);
    if(hty===0)hty=1e-10;
    const Dy=matVec(D,y);
    const ytDy=vecDot(y,Dy);
    const f1=(1+ytDy/hty)/hty, f2=1/hty;
    for(let i=0;i<xsize;i++)for(let j=0;j<xsize;j++)
      D.add(i,j,f1*h[i]*h[j]-f2*(h[i]*Dy[j]+Dy[i]*h[j]));
    const Dg=matVec(D,grad);
    for(let i=0;i<xsize;i++)xdir[i]=-Dg[i];
    lineSearch(subsys,xdir);
    err=subsys.error();
    for(let i=0;i<xsize;i++)h[i]=x[i];
    subsys.getParams(null,x);
    for(let i=0;i<xsize;i++)h[i]=x[i]-h[i];
  }
  subsys.revertParams();
  this.lastIterations=iters;
  if(err<=smallF)return SolveStatus.Success;
  if(vecNorm(h)<=convCriterion)return SolveStatus.Converged;
  return SolveStatus.Failed;
};

System.prototype.solve_LM=function(subsys,isRedundantsolving){
  const xsize=subsys.pSize(), csize=subsys.cSize();
  if(xsize===0)return SolveStatus.Success;
  let e=vecZero(csize), e_new=vecZero(csize);
  const J=new Mat(csize,xsize);
  let x=vecZero(xsize), x_new=vecZero(xsize);
  subsys.redirectParams();
  subsys.getParams(null,x);
  subsys.calcResidual(e);
  for(let i=0;i<csize;i++)e[i]=-e[i];
  let maxIterNumber=(this.sketchSizeMultiplier?this.maxIter*xsize:this.maxIter);
  const divergingLim=1e6*vecSqNorm(e)+1e12;
  let eps=this.LM_eps, eps1=this.LM_eps1, tau=this.LM_tau;
  if(isRedundantsolving){
    maxIterNumber=(this.sketchSizeMultiplierRedundant?this.maxIterRedundant*xsize:this.maxIterRedundant);
    eps=this.LM_epsRedundant; eps1=this.LM_eps1Redundant; tau=this.LM_tauRedundant;
  }
  let nu=2, mu=0, iter=0, stop=0;
  for(iter=0;iter<maxIterNumber&&!stop;++iter){
    const err=vecSqNorm(e);
    if(err<=eps*eps){ stop=1; break; }
    if(err>divergingLim||err!==err){ stop=6; break; }
    subsys.calcJacobi(null,J);
    const A=matTMul(J,J);
    const g=matTVec(J,e);
    const g_inf=vecInfNorm(g);
    const diag_A=vecZero(xsize);
    for(let i=0;i<xsize;i++)diag_A[i]=A.get(i,i);
    if(g_inf<=eps1){ stop=2; break; }
    if(iter===0)mu=tau*vecInfNorm(diag_A);
    let k=0;
    while(k<50){
      for(let i=0;i<xsize;i++)A.set(i,i,diag_A[i]+mu);
      const h=fullPivLuSolve(A,g);
      const Ah=matVec(A,h);
      let num=0;
      for(let i=0;i<xsize;i++){ const d=Ah[i]-g[i]; num+=d*d; }
      const rel_error=Math.sqrt(num)/vecNorm(g);
      if(rel_error<1e-5){
        const sc=subsys.maxStep(null,h);
        if(sc<1)for(let i=0;i<xsize;i++)h[i]*=sc;
        for(let i=0;i<xsize;i++)x_new[i]=x[i]+h[i];
        const h_norm=vecSqNorm(h);
        if(h_norm<=eps1*eps1*vecNorm(x)){ stop=3; break; }
        if(h_norm>=(vecNorm(x)+eps1)/(EPS_MACH*EPS_MACH)){ stop=4; break; }
        subsys.setParams(null,x_new);
        subsys.calcResidual(e_new);
        for(let i=0;i<csize;i++)e_new[i]=-e_new[i];
        const dF=vecSqNorm(e)-vecSqNorm(e_new);
        let dL=0;
        for(let i=0;i<xsize;i++)dL+=h[i]*(mu*h[i]+g[i]);
        if(dF>0&&dL>0){
          const tmp=2*dF/dL-1;
          mu*=Math.max(1/3,1-tmp*tmp*tmp);
          nu=2;
          const t=x; x=x_new; x_new=t;
          const te=e; e=e_new; e_new=te;
          break;
        }
      }
      mu*=nu; nu*=2;
      for(let i=0;i<xsize;i++)A.set(i,i,diag_A[i]);
      k++;
    }
    if(k>50){ stop=7; break; }
  }
  if(iter>=maxIterNumber)stop=5;
  subsys.revertParams();
  this.lastIterations=iter;
  return (stop===1)?SolveStatus.Success:SolveStatus.Failed;
};

/* Powell's DogLeg: a Gauss-Newton step when the trust region allows it, the
   steepest-descent step when it does not, and a blend in between. */
System.prototype.solve_DL=function(subsys,isRedundantsolving){
  const xsize=subsys.pSize(), csize=subsys.cSize();
  if(xsize===0)return SolveStatus.Success;
  let tolg=this.DL_tolg, tolx=this.DL_tolx, tolf=this.DL_tolf;
  let maxIterNumber=(this.sketchSizeMultiplier?this.maxIter*xsize:this.maxIter);
  if(isRedundantsolving){
    tolg=this.DL_tolgRedundant; tolx=this.DL_tolxRedundant; tolf=this.DL_tolfRedundant;
    maxIterNumber=(this.sketchSizeMultiplierRedundant?this.maxIterRedundant*xsize:this.maxIterRedundant);
  }
  let x=vecZero(xsize), x_new=vecZero(xsize);
  let fx=vecZero(csize), fx_new=vecZero(csize);
  let Jx=new Mat(csize,xsize), Jx_new=new Mat(csize,xsize);
  let h_dl=vecZero(xsize);
  subsys.redirectParams();
  const eo={err:0};
  subsys.getParams(null,x);
  subsys.calcResidual(fx,eo);
  let err=eo.err;
  subsys.calcJacobi(null,Jx);
  let g=matTVec(Jx,fx);
  for(let i=0;i<xsize;i++)g[i]=-g[i];
  let g_inf=vecInfNorm(g), fx_inf=vecInfNorm(fx);
  const divergingLim=1e6*err+1e12;
  let delta=0.1, alpha=0, nu=2, iter=0, stop=0, reduce=0;
  while(!stop){
    if(fx_inf<=tolf){ stop=1; break; }
    if(g_inf<=tolg){ stop=2; break; }
    if(delta<=tolx*(tolx+vecNorm(x))){ stop=2; break; }
    if(iter>=maxIterNumber){ stop=4; break; }
    if(err>divergingLim||err!==err){ stop=6; break; }
    const Jg=matVec(Jx,g);
    alpha=vecSqNorm(g)/vecSqNorm(Jg);
    const h_sd=vecZero(xsize);
    for(let i=0;i<xsize;i++)h_sd[i]=alpha*g[i];
    // Gauss-Newton step of least norm: J'*(J*J')^-1*(-fx)
    const JJt=matMulT(Jx,Jx);
    const negfx=vecZero(csize);
    for(let i=0;i<csize;i++)negfx[i]=-fx[i];
    const w=(this.dogLegGaussStep===DogLegGaussStep.LeastNormFullPivLU)
      ?fullPivLuSolve(JJt,negfx):ldltSolve(JJt,negfx);
    const h_gn=matTVec(Jx,w);
    const Jh=matVec(Jx,h_gn);
    let rn=0;
    for(let i=0;i<csize;i++){ const d=Jh[i]+fx[i]; rn+=d*d; }
    const rel_error=Math.sqrt(rn)/vecNorm(fx);
    if(rel_error>1e15)break;
    const gn_norm=vecNorm(h_gn), sd_norm=vecNorm(h_sd);
    if(gn_norm<delta){
      h_dl=h_gn;
      if(vecNorm(h_dl)<=tolx*(tolx+vecNorm(x))){ stop=5; break; }
    } else if(alpha*vecNorm(g)>=delta){
      const f=delta/(alpha*vecNorm(g));
      h_dl=vecZero(xsize);
      for(let i=0;i<xsize;i++)h_dl[i]=f*h_sd[i];
    } else {
      let beta=0;
      const b=vecZero(xsize);
      for(let i=0;i<xsize;i++)b[i]=h_gn[i]-h_sd[i];
      const bb=vecSqNorm(b);
      const gb=Math.abs(vecDot(h_sd,b));
      const c=(delta+sd_norm)*(delta-sd_norm);
      if(gb>0)beta=c/(gb+Math.sqrt(gb*gb+c*bb));
      else beta=(Math.sqrt(gb*gb+c*bb)-gb)/bb;
      h_dl=vecZero(xsize);
      for(let i=0;i<xsize;i++)h_dl[i]=h_sd[i]+beta*b[i];
    }
    for(let i=0;i<xsize;i++)x_new[i]=x[i]+h_dl[i];
    subsys.setParams(null,x_new);
    const eo2={err:0};
    subsys.calcResidual(fx_new,eo2);
    const err_new=eo2.err;
    subsys.calcJacobi(null,Jx_new);
    const Jhdl=matVec(Jx,h_dl);
    let lin=0;
    for(let i=0;i<csize;i++){ const d=fx[i]+Jhdl[i]; lin+=d*d; }
    const dL=err-0.5*lin;
    const dF=err-err_new;
    let rho=dL/dF;
    if(dF>0&&dL>0){
      const tx=x; x=x_new; x_new=tx;
      const tj=Jx; Jx=Jx_new; Jx_new=tj;
      const tf=fx; fx=fx_new; fx_new=tf;
      err=err_new;
      g=matTVec(Jx,fx);
      for(let i=0;i<xsize;i++)g[i]=-g[i];
      g_inf=vecInfNorm(g); fx_inf=vecInfNorm(fx);
    } else rho=-1;
    if(Math.abs(rho-1)<0.2&&vecNorm(h_dl)>delta/3&&reduce<=0){ delta=3*delta; nu=2; reduce=0; }
    else if(rho<0.25){ delta=delta/nu; nu=2*nu; reduce=2; }
    else reduce--;
    iter++;
  }
  subsys.setParams(null,x);
  subsys.revertParams();
  this.lastIterations=iter;
  return (stop===1)?SolveStatus.Success:SolveStatus.Failed;
};

/* Two subsystems, A before B: A holds the real constraints, B the temporary
   ones a drag adds.  The SQP satisfies A exactly and gets as close to B as
   what is left allows — which is why a dragged point follows the cursor only
   as far as the sketch lets it. */
System.prototype.solveAB=function(subsysA,subsysB,isFine,isRedundantsolving){
  const csizeA=subsysA.cSize();
  const setA=new Set(subsysA.getParamList());
  const plistAB=subsysA.getParamList();
  for(const p of subsysB.getParamList()) if(!setA.has(p))plistAB.push(p);
  const xsize=plistAB.length;
  if(xsize===0)return SolveStatus.Success;
  let B=matIdentity(xsize);
  const JA=new Mat(csizeA,xsize);
  let resA=vecZero(csizeA);
  let lambda=vecZero(csizeA), lambda0=vecZero(csizeA), lambdadir=vecZero(csizeA);
  let x=vecZero(xsize), x0=vecZero(xsize);
  let grad=vecZero(xsize), h=vecZero(xsize), y=vecZero(xsize);
  subsysA.redirectParams(); subsysB.redirectParams();
  subsysB.getParams(plistAB,x); subsysA.getParams(plistAB,x);
  subsysB.setParams(plistAB,x);
  subsysB.calcGrad(plistAB,grad);
  subsysA.calcJacobi(plistAB,JA);
  subsysA.calcResidual(resA);
  const maxIterNumber=(isRedundantsolving
    ?(this.sketchSizeMultiplierRedundant?this.maxIterRedundant*xsize:this.maxIterRedundant)
    :(this.sketchSizeMultiplier?this.maxIter*xsize:this.maxIter));
  const divergingLim=1e6*subsysA.error()+1e12;
  let mu=0;
  const qp={x:null,Y:null,Z:null};
  let iter;
  for(iter=1;iter<maxIterNumber;iter++){
    const status=qp_eq(B,grad,JA,resA,qp);
    if(status)break;
    const xdir=qp.x, Y=qp.Y;
    for(let i=0;i<xsize;i++)x0[i]=x[i];
    for(let i=0;i<csizeA;i++)lambda0[i]=lambda[i];
    const Bx=matVec(B,xdir);
    const t=vecZero(xsize);
    for(let i=0;i<xsize;i++)t[i]=Bx[i]+grad[i];
    lambda=matTVec(Y,t);
    for(let i=0;i<csizeA;i++)lambdadir[i]=lambda[i]-lambda0[i];
    {
      const eta=0.25, tau=0.5, rho=0.5;
      let alpha=Math.min(1,subsysA.maxStep(plistAB,xdir));
      const xBx=vecDot(xdir,matVec(B,xdir));
      mu=Math.max(mu,(vecDot(grad,xdir)+Math.max(0,0.5*xBx))/((1-rho)*vecL1(resA)));
      const f0=subsysB.error()+mu*vecL1(resA);
      const deriv=vecDot(grad,xdir)-mu*vecL1(resA);
      for(let i=0;i<xsize;i++)x[i]=x0[i]+alpha*xdir[i];
      subsysA.setParams(plistAB,x); subsysB.setParams(plistAB,x);
      subsysA.calcResidual(resA);
      let f=subsysB.error()+mu*vecL1(resA);
      let first=true, guard=0;
      while(f>f0+eta*alpha*deriv&&guard++<200){
        if(first){
          first=false;
          const xdir1=matVec(Y,resA);
          for(let i=0;i<xsize;i++)x[i]-=xdir1[i];
          subsysA.setParams(plistAB,x); subsysB.setParams(plistAB,x);
          subsysA.calcResidual(resA);
          f=subsysB.error()+mu*vecL1(resA);
          if(f<f0+eta*alpha*deriv)break;
        }
        alpha=tau*alpha;
        if(alpha<1e-8)alpha=0;
        for(let i=0;i<xsize;i++)x[i]=x0[i]+alpha*xdir[i];
        subsysA.setParams(plistAB,x); subsysB.setParams(plistAB,x);
        subsysA.calcResidual(resA);
        f=subsysB.error()+mu*vecL1(resA);
        if(alpha<1e-8)break;
      }
      for(let i=0;i<csizeA;i++)lambda[i]=lambda0[i]+alpha*lambdadir[i];
    }
    for(let i=0;i<xsize;i++)h[i]=x[i]-x0[i];
    const JTl=matTVec(JA,lambda);
    for(let i=0;i<xsize;i++)y[i]=grad[i]-JTl[i];
    subsysB.calcGrad(plistAB,grad);
    subsysA.calcJacobi(plistAB,JA);
    subsysA.calcResidual(resA);
    const JTl2=matTVec(JA,lambda);
    for(let i=0;i<xsize;i++)y[i]=grad[i]-JTl2[i]-y[i];
    if(iter>1){
      const yTh=vecDot(y,h);
      if(yTh!==0){
        const Bh=matVec(B,h);
        const hBh=vecDot(h,Bh);
        for(let i=0;i<xsize;i++)for(let j=0;j<xsize;j++)
          B.add(i,j,y[i]*y[j]/yTh-Bh[i]*Bh[j]/hBh);
      }
    }
    const err=subsysA.error();
    const conv=isRedundantsolving?this.convergenceRedundant:this.convergence;
    if(vecNorm(h)<=conv&&err<=smallF)break;
    if(err>divergingLim||err!==err)break;
  }
  this.lastIterations=iter;
  let ret;
  const conv=isRedundantsolving?this.convergenceRedundant:this.convergence;
  if(subsysA.error()<=smallF)ret=SolveStatus.Success;
  else if(vecNorm(h)<=conv)ret=SolveStatus.Converged;
  else ret=SolveStatus.Failed;
  subsysA.revertParams(); subsysB.revertParams();
  return ret;
};

/* ---- diagnosis (System::diagnose and friends) --------------------------
   The Jacobian's rank is the whole point: degrees of freedom are parameters
   minus rank, and a constraint that adds no rank is either redundant (the
   system still solves without it) or conflicting (it does not).  Telling
   those two apart needs a solve, which is exactly what happens below. */
System.prototype.makeReducedJacobian=function(){
  const pdiagnoselist=[];
  const driven=new Set(this.pdrivenlist);
  for(const p of this.plist) if(!driven.has(p))pdiagnoselist.push(p);
  const col=new Map();
  for(let j=0;j<pdiagnoselist.length;j++)col.set(pdiagnoselist[j],j);
  const rows=[], tagmultiplicity=new Map();
  let allcount=0;
  for(const c of this.clist){
    c.revertParams();
    if(c.getTag()>=0&&c.driving){
      rows.push(allcount);
      if(!tagmultiplicity.has(c.getTag()))tagmultiplicity.set(c.getTag(),0);
      else tagmultiplicity.set(c.getTag(),tagmultiplicity.get(c.getTag())+1);
    }
    allcount++;
  }
  const J=new Mat(rows.length,pdiagnoselist.length);
  for(let i=0;i<rows.length;i++){
    const c=this.clist[rows[i]];
    for(const p of c.pvec){
      const j=col.get(p);
      if(j===undefined)continue;
      J.set(i,j,c.grad(p));
    }
  }
  return {J:J,map:rows,pdiagnoselist:pdiagnoselist,tagmultiplicity:tagmultiplicity};
};
function eliminateNonZerosOverPivot(R,rank){
  for(let i=1;i<rank;i++){
    for(let row=0;row<i;row++){
      if(Math.abs(R.get(row,i))>1e-10){
        const coef=R.get(row,i)/R.get(i,i);
        for(let j=i+1;j<R.c;j++)R.add(row,j,-coef*R.get(i,j));
      }
      R.set(row,i,0);
    }
  }
}
System.prototype.identifyDependentParameters=function(J,pdiagnoselist){
  const qrJ=new FullPivQR(J);
  const rank=qrJ.rank(this.qrpivotThreshold);
  const Rparams=qrJ.matrixR();
  eliminateNonZerosOverPivot(Rparams,rank);
  this.pDependentParametersGroups=[];
  this.pDependentParameters=[];
  for(let j=rank;j<qrJ.n;j++){
    const group=[];
    for(let row=0;row<rank;row++){
      if(Math.abs(Rparams.get(row,j))>1e-10){
        const origCol=qrJ.colPerm[row];
        group.push(pdiagnoselist[origCol]);
        this.pDependentParameters.push(pdiagnoselist[origCol]);
      }
    }
    const origCol=qrJ.colPerm[j];
    group.push(pdiagnoselist[origCol]);
    this.pDependentParameters.push(pdiagnoselist[origCol]);
    this.pDependentParametersGroups.push(group);
  }
};
System.prototype.identifyConflictingRedundantConstraints=function(alg,qrJT,jmap,tagmultiplicity,
    pdiagnoselist,R,constrNum,rank){
  eliminateNonZerosOverPivot(R,rank);
  let conflictGroups=[];
  for(let j=rank;j<constrNum;j++){
    const g=[];
    for(let row=0;row<rank;row++)
      if(Math.abs(R.get(row,j))>1e-10)g.push(this.clist[jmap[qrJT.colPerm[row]]]);
    g.push(this.clist[jmap[qrJT.colPerm[j]]]);
    conflictGroups.push(g);
  }
  /* Which constraint of a dependent group to blame: the one that appears in
     the most groups, then the one that costs the fewest solver constraints,
     then the newest.  Upstream's heuristic, kept whole. */
  const skipped=new Set(), satisfiedGroups=new Set();
  for(;;){
    const conflictingMap=new Map();
    for(let i=0;i<conflictGroups.length;i++){
      if(satisfiedGroups.has(i))continue;
      for(const c of conflictGroups[i]){
        if(c.getTag()===0||c.internalAlignment)continue;
        let s=conflictingMap.get(c);
        if(!s){ s=new Set(); conflictingMap.set(c,s); }
        s.add(i);
      }
    }
    if(!conflictingMap.size)break;
    let bestC=null, bestSet=null;
    const mult=(t)=>tagmultiplicity.has(t)?tagmultiplicity.get(t):0;
    for(const e of conflictingMap){
      if(bestC===null){ bestC=e[0]; bestSet=e[1]; continue; }
      const s1=bestSet.size, s2=e[1].size, t1=bestC.getTag(), t2=e[0].getTag();
      const greater=(s2>s1)||(s2===s1&&mult(t2)<mult(t1))||
                    (s2===s1&&mult(t2)===mult(t1)&&t2>t1);
      if(greater){ bestC=e[0]; bestSet=e[1]; }
    }
    if(!bestSet||!bestSet.size)break;
    const maxTag=bestC.getTag();
    for(const e of conflictingMap){
      if(e[0].getTag()!==maxTag)continue;
      skipped.add(e[0]);
      for(const i of e[1])satisfiedGroups.add(i);
    }
  }
  const clistTmp=this.clist.filter(c=>c.driving&&!skipped.has(c));
  const snapshot=this.plist.map(p=>p.v);
  const subSysTmp=new SubSystem(clistTmp,pdiagnoselist,null);
  const res=this.solveSub(subSysTmp,true,alg,true);
  if(res===SolveStatus.Success){
    subSysTmp.applySolution();
    for(const c of skipped){
      const err=c.error();
      if(err*err<this.convergenceRedundant)this.redundant.add(c);
    }
    for(let i=0;i<this.plist.length;i++)this.plist[i].v=snapshot[i];
    const orig=conflictGroups;
    conflictGroups=[];
    for(let i=orig.length-1;i>=0;i--){
      const hasRedundant=orig[i].some(c=>this.redundant.has(c));
      if(!hasRedundant){ conflictGroups.push(orig[i]); continue; }
      constrNum--;
    }
  } else {
    for(let i=0;i<this.plist.length;i++)this.plist[i].v=snapshot[i];
  }
  const conflictingTagsSet=new Set();
  for(const g of conflictGroups)
    for(const c of g)conflictingTagsSet.add(c.internalAlignment?0:c.getTag());
  conflictingTagsSet.delete(0);
  this.conflictingTags=Array.from(conflictingTagsSet).sort((a,b)=>a-b);
  const redundantTagsSet=new Set(), partial=new Set();
  for(const c of this.redundant){ redundantTagsSet.add(c.getTag()); partial.add(c.getTag()); }
  for(const c of this.clist) if(!this.redundant.has(c))redundantTagsSet.delete(c.getTag());
  this.redundantTags=Array.from(redundantTagsSet).sort((a,b)=>a-b);
  for(const t of redundantTagsSet)partial.delete(t);
  this.partiallyRedundantTags=Array.from(partial).sort((a,b)=>a-b);
  return constrNum;
};
System.prototype.diagnose=function(alg){
  if(alg==null)alg=Algorithm.DogLeg;
  this.hasDiagnosis=false;
  if(!this.hasUnknowns){ this.dofs=-1; return this.dofs; }
  if(!this.plist.length||(this.plist.length-this.pdrivenlist.length)===0){
    this.hasDiagnosis=true; this.emptyDiagnoseMatrix=true; this.dofs=0; return this.dofs;
  }
  this.redundant=new Set();
  this.conflictingTags=[]; this.redundantTags=[]; this.partiallyRedundantTags=[];
  const red=this.makeReducedJacobian();
  const J=red.J, pdiagnoselist=red.pdiagnoselist;
  this.hasDiagnosis=true;
  this.dofs=pdiagnoselist.length;
  if(J.r===0){ this.emptyDiagnoseMatrix=true; return this.dofs; }
  this.emptyDiagnoseMatrix=false;
  /* Upstream always runs this second decomposition (in parallel, on another
     thread). It answers "which parameters are still free", which is a separate
     question from the rank, and it costs as much as the rank itself — so here
     it is opt-in and off during a drag. */
  if(this.computeDependentParameters)this.identifyDependentParameters(J,pdiagnoselist);
  else { this.pDependentParameters=[]; this.pDependentParametersGroups=[]; }
  const JT=matTranspose(J);
  const qrJT=new FullPivQR(JT);
  const rank=qrJT.rank(this.qrpivotThreshold);
  const R=qrJT.matrixR();
  const paramsNum=qrJT.m, constrNum=qrJT.n;
  this.dofs=paramsNum-rank;
  this.lastRank=rank;
  if(constrNum>rank){
    const nonredundant=this.identifyConflictingRedundantConstraints(alg,qrJT,red.map,
      red.tagmultiplicity,pdiagnoselist,R,constrNum,rank);
    if(paramsNum===rank&&nonredundant>rank)this.dofs=paramsNum-nonredundant;
  }
  return this.dofs;
};
System.prototype.dofsNumber=function(){ return this.hasDiagnosis?this.dofs:-1; };
System.prototype.hasConflicting=function(){ return !(this.hasDiagnosis&&!this.conflictingTags.length); };
System.prototype.hasRedundant=function(){ return !(this.hasDiagnosis&&!this.redundantTags.length); };
System.prototype.hasPartiallyRedundant=function(){
  return !(this.hasDiagnosis&&!this.partiallyRedundantTags.length); };
System.prototype.calculateConstraintErrorByTag=function(tagId){
  let sum=0, n=0, last=0;
  for(const c of this.clist){
    if(c.getTag()!==tagId)continue;
    const e=c.error(); last=e; sum+=e*e; n++;
  }
  if(n===0)return NaN;
  if(n===1)return last;
  return Math.sqrt(sum/n);
};
/* the largest residual over the driving constraints — "is this sketch
   actually satisfied", asked of the numbers rather than of the rank */
System.prototype.maxResidual=function(){
  let m=0;
  for(const c of this.clist){
    if(!c.driving||c.getTag()<0)continue;
    const e=Math.abs(c.error());
    if(e>m)m=e;
  }
  return m;
};

global.PlaneGCS={
  Param:param, Point:Point, Line:Line, Circle:Circle,
  System:System, SubSystem:SubSystem, Constraint:Constraint,
  ConstraintEqual:ConstraintEqual, ConstraintDifference:ConstraintDifference,
  ConstraintP2PDistance:ConstraintP2PDistance, ConstraintP2PAngle:ConstraintP2PAngle,
  ConstraintP2LDistance:ConstraintP2LDistance, ConstraintPointOnLine:ConstraintPointOnLine,
  ConstraintPointOnPerpBisector:ConstraintPointOnPerpBisector,
  ConstraintParallel:ConstraintParallel, ConstraintPerpendicular:ConstraintPerpendicular,
  ConstraintL2LAngle:ConstraintL2LAngle, ConstraintMidpointOnLine:ConstraintMidpointOnLine,
  ConstraintTangentCircumf:ConstraintTangentCircumf,
  ConstraintEqualLineLength:ConstraintEqualLineLength,
  ConstraintPolygonCorner:ConstraintPolygonCorner,
  ConstraintType:CT, Algorithm:Algorithm, SolveStatus:SolveStatus,
  DogLegGaussStep:DogLegGaussStep,
  DeriVector2:DeriVector2,
  linalg:{Mat:Mat, FullPivQR:FullPivQR, fullPivLuSolve:fullPivLuSolve, ldltSolve:ldltSolve,
          matMul:matMul, matTMul:matTMul, matMulT:matMulT, matTranspose:matTranspose,
          matVec:matVec, matTVec:matTVec, identity:matIdentity},
  qp_eq:qp_eq, lineSearch:lineSearch,
  upstream:{project:'FreeCAD PlaneGCS', licence:'LGPL-2.1-or-later',
            commit:'fda5c1438057ec84fb1d5bd0f45fb29e94e0c8e1',
            url:'https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs'},
  version:1
};
})(typeof globalThis!=='undefined'?globalThis:this);
// plain <script> in the browser; require() in node for the test suite
if(typeof module!=='undefined'&&module.exports)module.exports=(typeof globalThis!=='undefined'?globalThis:this).PlaneGCS;
