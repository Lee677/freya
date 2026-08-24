// Exact volume of the lantern hull: the app's centripetal Catmull-Rom profile
// revolved about the sketch v axis, integrated by Pappus over the closed loop.
const PTS=[{x:0,y:-14},{x:7.5,y:-13},{x:11,y:-8},{x:9.5,y:-2},{x:12.5,y:6},
           {x:9,y:14},{x:4.5,y:20},{x:1.6,y:26},{x:0,y:31}];
const ALPHA=0.5;
function spans(P, closed){
  const n=P.length;
  const at=i=>{ if(closed)return P[((i%n)+n)%n];
    if(i<0)   return {x:2*P[0].x-P[1].x, y:2*P[0].y-P[1].y};
    if(i>n-1) return {x:2*P[n-1].x-P[n-2].x, y:2*P[n-1].y-P[n-2].y};
    return P[i]; };
  const dist=(a,b)=>Math.max(1e-6,Math.pow(Math.hypot(b.x-a.x,b.y-a.y),ALPHA));
  const out=[], last=closed?n:n-1;
  for(let i=0;i<last;i++){
    const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2);
    const d1=dist(p0,p1),d2=dist(p1,p2),d3=dist(p2,p3);
    const b1={x:(d1*d1*p2.x-d2*d2*p0.x+(2*d1*d1+3*d1*d2+d2*d2)*p1.x)/(3*d1*(d1+d2)),
              y:(d1*d1*p2.y-d2*d2*p0.y+(2*d1*d1+3*d1*d2+d2*d2)*p1.y)/(3*d1*(d1+d2))};
    const b2={x:(d3*d3*p1.x-d2*d2*p3.x+(2*d3*d3+3*d3*d2+d2*d2)*p2.x)/(3*d3*(d3+d2)),
              y:(d3*d3*p1.y-d2*d2*p3.y+(2*d3*d3+3*d3*d2+d2*d2)*p2.y)/(3*d3*(d3+d2))};
    out.push([p1,b1,b2,p2]);
  }
  return out;
}
const bez=(s,t)=>{const u=1-t;return {
  x:u*u*u*s[0].x+3*u*u*t*s[1].x+3*u*t*t*s[2].x+t*t*t*s[3].x,
  y:u*u*u*s[0].y+3*u*u*t*s[1].y+3*u*t*t*s[2].y+t*t*t*s[3].y};};

function volume(steps){
  const S=spans(PTS,false);
  const loop=[];
  S.forEach((s,i)=>{ for(let k=0;k<steps;k++) loop.push(bez(s,k/steps)); });
  loop.push(PTS[PTS.length-1]);
  loop.push({x:0,y:-14});                 // the straight closing run back down the axis
  // 2*pi * integral of x dA, via the closed contour: |x| == x here (profile is x>=0)
  let I=0;
  for(let i=0;i<loop.length;i++){
    const a=loop[i], b=loop[(i+1)%loop.length];
    I += (b.y-a.y)*(a.x*a.x + a.x*b.x + b.x*b.x)/6;
  }
  return 2*Math.PI*Math.abs(I);
}
for(const n of [16,64,256,1024,4096,16384]) console.log(String(n).padStart(6), volume(n).toFixed(4));
