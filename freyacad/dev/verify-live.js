/* freyacad live-document suite — the half verify.js cannot reach.
 *
 * verify.js runs everything through buildPartShapes, which always builds cold
 * with checkpoints off. That is the right way to measure the kernel, and it is
 * also why it cannot see the two things that bite hardest in normal use: the
 * geometry cache (trap 25) and the per-feature checkpoints (trap 29). This file
 * drives the real document instead — insertFeature, openProps, rebuild — and
 * checks one invariant over and over:
 *
 *     a rebuild that restores a checkpoint must produce exactly the same solid
 *     as a cold build of the same feature list.
 *
 * It matters most for a mirror or pattern SCOPED to chosen features, because a
 * scoped copy reuses its source feature's tool shape, and that tool only exists
 * if the source actually ran. Restore a checkpoint that skipped it and the
 * pattern has nothing to copy. rebuild() therefore refuses any checkpoint at or
 * above the shallowest feature a scope points at. Case `patternPanel` is the one
 * that fails without that guard: opening the pattern's own property panel bars
 * the checkpoint taken AT the pattern, so the next one down is the flush just
 * below it — exactly the one that skips the source.
 *
 * It also covers the drawing, for the same reason: a view is built from the live
 * document, so buildPartShapes never sees one.
 *
 * Paste into the console with freyacad open (or run it through dev/headless.js),
 * then read window.__VERLIVE. Every case reports {ok}.
 */
window.__VERLIVE = 'running';
(function(){
  const C=window.__C, oc=window.OCCT;
  const F=o=>Object.assign({suppressed:false},o);
  const rect=(a,b)=>({type:'rect',a:a,b:b}), circ=(c,r)=>({type:'circle',c:c,r:r});
  const sk=(ents,plane)=>F({id:C.nextId(),type:'sketch',name:'s',
    plane:{kind:'datum',name:plane||'Top'},entities:ents,fillet:0,chamfer:0});
  function volOf(shapes){
    let v=0;
    for(const s of shapes){
      const g=new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(s,g,1e-4,false,false);
      v+=g.Mass();
    }
    return +v.toFixed(3);
  }
  const live=()=>volOf(C.resultShapes);
  /* The cold reference has to see what the live rebuild sees. While a property
     panel is open that is the DRAFT, not the committed feature — compare
     against the committed one and every panel case reads as a mismatch when
     nothing is wrong. */
  const cold=()=>{
    const pf=C.propsFeat, df=C.draftFeat;
    return volOf(C.buildPartShapes(
      C.features.map(f=>(pf&&df&&pf.id===f.id)?df:f)).shapes);
  };
  /* what the panel's Done button does */
  const commit=f=>{ Object.assign(f, C.draftFeat); C.closeProps(); C.rebuild(); };
  const errs=()=>C.features.filter(f=>f.error).map(f=>(f.name||f.type)+': '+f.error);

  /* disc · hole · circular pattern scoped to the hole · a slot on the end.
     The slot is there so the pattern is not the last feature — without
     something above it there is no reason for a rebuild to reach for a
     checkpoint at all. */
  function build(){
    C.closeProps(); C.features.length=0; C.rebuild();
    const s1=sk([circ({x:0,y:0},10)]); C.insertFeature(s1);
    C.insertFeature(F({id:C.nextId(),type:'extrude',name:'disc',sketchId:s1.id,depth:3,merge:true}));
    const s2=sk([circ({x:6,y:0},1.5)]); C.insertFeature(s2);
    const hole=F({id:C.nextId(),type:'cut',name:'hole',sketchId:s2.id,depth:3,through:true,flip:true});
    C.insertFeature(hole);
    const pat=F({id:C.nextId(),type:'cpattern',name:'p',axis:'Y',count:6,angle:360,
                 equal:true,merge:false,scope:[hole.id]});
    C.insertFeature(pat);
    const s3=sk([rect({x:-1.5,y:-1.5},{x:1.5,y:1.5})]); C.insertFeature(s3);
    const slot=F({id:C.nextId(),type:'cut',name:'slot',sketchId:s3.id,depth:3,through:true,flip:true});
    C.insertFeature(slot);
    C.rebuild();
    return {hole:hole, pat:pat, slot:slot};
  }

  const res={};
  function check(name, want){
    const l=live(), c=cold(), e=errs();
    res[name]={live:l, cold:c, ckpts:C.checkpoints.length, errs:e,
               ok:(l===c) && !e.length && (want==null || Math.abs(l-want)<0.01)};
    if(want!=null) res[name].want=want;
  }

  try{
    /* 1. the plain build. disc 300π, six holes of 6.75π, a 3x3x3 slot:
          259.5π - 27 = 788.243 */
    const f=build();
    check('firstBuild', 788.243);

    /* 2. edit the feature ABOVE the pattern. The deepest usable checkpoint is
          the one taken at the pattern itself, so the pattern does not re-run —
          the copies have to already be in the restored body. */
    C.openProps(f.slot); C.draftFeat.depth=3; C.rebuild();
    C.closeProps(); C.rebuild();
    check('editAbove', 788.243);

    /* 3. the case the scope floor exists for. Opening the pattern's own panel
          bars every checkpoint at or above it, so the rebuild reaches for the
          flush BELOW the pattern — which is exactly the one that would skip the
          hole whose tool the pattern copies. Eight holes: 300π - 54π - 27. */
    C.openProps(f.pat); C.draftFeat.count=8; C.rebuild();
    check('patternPanel', 246*Math.PI-27);
    commit(f.pat);
    check('patternPanelDone', 246*Math.PI-27);

    /* 4. edit the source BELOW the pattern: every copy has to follow it, and
          every checkpoint at or above it has to be thrown away.
          eight holes of r=2 -> 300π - 96π - 27 */
    const s2=C.features.find(x=>x.type==='sketch'&&x.entities[0].r===1.5);
    s2.entities[0].r=2; C.rebuild();
    check('editSource', 204*Math.PI-27);

    /* 5. delete the source: the pattern must not be left pointing at a hole in
          the feature list, it must fall back to copying the whole body. */
    C.deleteFeature(f.hole.id);
    res.afterDelete={scope:f.pat.scope===undefined?'dropped':f.pat.scope,
                     ok:f.pat.scope===undefined, errs:errs()};

    /* ---- drawings: circles, axes and the marks made from them --------------
       A centre mark needs the model's circular edges, and those are found in
       SPACE rather than on the sheet — which is what lets one detector serve
       both a hole seen face-on (a cross) and the same hole seen edge-on (a line
       down its axis, along the hole rather than across it). Both orientations
       are checked here because getting one right and the other wrong is exactly
       the failure this design exists to avoid. */
    C.closeProps(); C.features.length=0; C.rebuild();
    const p1=sk([rect({x:-20,y:-10},{x:20,y:10})]); C.insertFeature(p1);
    C.insertFeature(F({id:C.nextId(),type:'extrude',name:'plate',sketchId:p1.id,depth:4,merge:true}));
    const p2=sk([circ({x:-10,y:0},3),circ({x:10,y:0},1.2)]); C.insertFeature(p2);
    C.insertFeature(F({id:C.nextId(),type:'cut',name:'holes',sketchId:p2.id,depth:3,through:true,flip:true}));
    // a hexagonal boss, which must NOT be mistaken for a circle
    const p3=sk([{type:'polygon',c:{x:0,y:5},r:2,n:6}]); C.insertFeature(p3);
    C.insertFeature(F({id:C.nextId(),type:'extrude',name:'hex',sketchId:p3.id,depth:2,merge:true}));
    C.rebuild();
    C.setDocMode('draw');
    C.addDrawView('top'); C.addDrawView('front');
    const top=C.draw.views[0], front=C.draw.views[1];
    const rr=a=>a.map(c=>+c.r.toFixed(3)).sort((x,y)=>x-y);
    res.drawCircles={ top:rr(top.geo.circles||[]), topAxes:(top.geo.axes||[]).length,
      front:(front.geo.circles||[]).length, frontAxes:(front.geo.axes||[]).length,
      /* face-on: two crosses and no lines. edge-on: two lines and no crosses.
         the hexagon appears in neither. */
      ok: JSON.stringify(rr(top.geo.circles||[]))==='[1.2,3]' &&
          (top.geo.axes||[]).length===0 &&
          (front.geo.circles||[]).length===0 &&
          (front.geo.axes||[]).length===2 };
    // an axis must run ALONG the hole (through the plate's 4 mm), not across it
    const ax=(front.geo.axes||[])[0]||{a:{x:0,y:0},b:{x:0,y:0}};
    const len=Math.hypot(ax.b.x-ax.a.x,ax.b.y-ax.a.y);
    res.axisAlongHole={len:+len.toFixed(3), ok:Math.abs(len-4)<1e-3};

    C.addAllCentreMarks(top); C.addAllCentreMarks(front);
    const n1=C.draw.marks.length;
    C.addAllCentreMarks(top); C.addAllCentreMarks(front);      // must add nothing twice
    res.autoMarks={count:n1, again:C.draw.marks.length,
      svg:document.querySelectorAll('#sheet .dw-mark').length,
      ok:n1===4 && C.draw.marks.length===4 &&
         document.querySelectorAll('#sheet .dw-mark').length===4};
    // removing a view takes its marks with it
    C.removeDrawView(front);
    res.marksFollowView={left:C.draw.marks.length,
      ok:C.draw.marks.length===2 && C.draw.marks.every(m=>m.view===top.id)};
    C.setDocMode('part');
    C.features.length=0; C.rebuild();
  }catch(e){ res.fail=(e&&e.stack)||String(e); }

  res.allOk=Object.keys(res).every(k=>k==='allOk'||res[k].ok!==false);
  window.__VERLIVE=res;
})();
'started — read window.__VERLIVE';
