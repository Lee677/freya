/* freyacad geometry regression suite.
 *
 * Paste the whole file into the browser console with freyacad open, then read
 * window.__VER. Every case is built through __C.buildPartShapes, which always
 * builds cold (checkpoints off), so this measures the kernel path and nothing
 * else. Compare the output against the previous commit — seven of the eight
 * cases are exact to the last digit, and any change in `vol`, `com`, `faces`,
 * `edges` or `bodies` means the geometry moved.
 *
 * How it has been used: `git stash` the working change, reload, run, unstash,
 * reload, run, diff the two JSON blobs. That is what caught every regression in
 * the boolean-batching and checkpoint work.
 *
 * The cases are chosen to cover the things that have actually broken:
 *   pillow      fillets and chamfers on a real part
 *   order       merge, merge, CUT, merge — proves a deferred merge is not
 *               applied before a cut that precedes it (the plug must survive)
 *   multibody   two extrudes that touch nothing — must stay TWO bodies
 *   mirror      mirror with merge
 *   cpattern    circular pattern with merge
 *   lpattern    linear pattern with merge
 *   filletrun   a run of fillets and cuts, which forces flush points
 *   lantern     the spline demo, fetched from models/ so both runs measure the
 *               same file
 *   scopecut    a circular pattern SCOPED to a hole — six holes in one disc,
 *               not six copies of the disc (the trap-22 case)
 *   scopeboss   a linear pattern scoped to a boss
 *   scopemirror a mirror scoped to a boss AND a bore at once, which pins the
 *               order down: the copied boss must be fused before the copied
 *               bore is cut, or the boss fills the hole back in
 *
 * The three scoped cases are all prisms and cylinders, so their volumes are
 * known exactly rather than only comparable — each carries its analytic `want`
 * and reports `ok`. Those are worth more than an A/B: they say the answer is
 * RIGHT, not merely unchanged.
 *
 * WARNING about the lantern: BRepGProp::VolumeProperties is inaccurate on a
 * single multi-span BSpline surface — it reads the hull ~1.46% light and reports
 * the same wrong figure at every Eps, so it looks converged when it is not (see
 * HANDOVER trap 27). Use it here only to compare like with like. To settle
 * whether the lantern's geometry really changed, mesh at several deflections and
 * sum signed tetrahedra, and check against dev/pappus-hull-volume.js.
 */
window.__VER = 'running';
(function(){
  const C = window.__C, oc = window.OCCT, OCK = C.OCK;
  const F = (o)=>Object.assign({suppressed:false}, o);
  let id = 0; const ID = ()=>++id;
  const rect=(a,b)=>({type:'rect',a:a,b:b});
  const circ=(c,r)=>({type:'circle',c:c,r:r});
  const sk=(ents,plane)=>F({id:ID(),type:'sketch',name:'s',
    plane:{kind:'datum',name:plane||'Top'},entities:ents,fillet:0,chamfer:0});

  /* Top plane is u=(1,0,0) v=(0,0,-1) n=(0,1,0): extrude runs along +Y. */
  function mkOrder(){ id=0; const out=[];
    const s1=sk([rect({x:-10,y:-10},{x:10,y:10})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'box1',sketchId:s1.id,depth:10,merge:true}));
    const s2=sk([rect({x:0,y:-10},{x:20,y:10})]); out.push(s2);
    out.push(F({id:ID(),type:'extrude',name:'box2',sketchId:s2.id,depth:6,merge:true}));
    const s3=sk([circ({x:0,y:0},4)]); out.push(s3);
    out.push(F({id:ID(),type:'cut',name:'hole',sketchId:s3.id,depth:3,through:true,flip:true}));
    const s4=sk([rect({x:-3,y:-3},{x:3,y:3})]); out.push(s4);   // must NOT be cut
    out.push(F({id:ID(),type:'extrude',name:'plug',sketchId:s4.id,depth:4,merge:true}));
    return out; }
  function mkMultibody(){ id=0; const out=[];
    const s1=sk([rect({x:-10,y:-10},{x:-2,y:10})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'a',sketchId:s1.id,depth:5,merge:true}));
    const s2=sk([rect({x:20,y:-10},{x:30,y:10})]); out.push(s2);   // nowhere near it
    out.push(F({id:ID(),type:'extrude',name:'b',sketchId:s2.id,depth:5,merge:true}));
    return out; }
  function mkMirror(){ id=0; const out=[];
    const s1=sk([rect({x:2,y:-4},{x:9,y:4})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'a',sketchId:s1.id,depth:5,merge:true}));
    const s2=sk([rect({x:-1,y:-2},{x:3,y:2})]); out.push(s2);
    out.push(F({id:ID(),type:'extrude',name:'bridge',sketchId:s2.id,depth:3,merge:true}));
    out.push(F({id:ID(),type:'mirror',name:'m',plane:'Right',merge:true}));
    return out; }
  function mkCPattern(){ id=0; const out=[];
    const s1=sk([circ({x:0,y:0},6)]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'hub',sketchId:s1.id,depth:4,merge:true}));
    const s2=sk([rect({x:5,y:-1},{x:12,y:1})]); out.push(s2);
    out.push(F({id:ID(),type:'extrude',name:'spoke',sketchId:s2.id,depth:2,merge:true}));
    out.push(F({id:ID(),type:'cpattern',name:'p',axis:'Y',count:5,angle:360,equal:true,merge:true}));
    return out; }
  function mkLPattern(){ id=0; const out=[];
    const s1=sk([rect({x:-2,y:-2},{x:2,y:2})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'a',sketchId:s1.id,depth:3,merge:true}));
    out.push(F({id:ID(),type:'lpattern',name:'p',dir:'X',count:4,spacing:3,merge:true}));
    return out; }
  /* The trap-22 case, and the reason the scoping work happened: a pattern of a
     HOLE has to cut more holes. Copying the whole body instead clones the disc
     five times over, which is both the wrong shape and a boolean per copy.
     disc 300π less six holes of 6.75π = 259.5π. */
  function mkScopeCut(){ id=0; const out=[];
    const s1=sk([circ({x:0,y:0},10)]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'disc',sketchId:s1.id,depth:3,merge:true}));
    const s2=sk([circ({x:6,y:0},1.5)]); out.push(s2);
    const hole=F({id:ID(),type:'cut',name:'hole',sketchId:s2.id,depth:3,through:true,flip:true});
    out.push(hole);
    out.push(F({id:ID(),type:'cpattern',name:'p',axis:'Y',count:6,angle:360,equal:true,
                merge:false,scope:[hole.id]}));
    return out; }
  /* plate 672 plus four bosses standing 3 proud of it, 12π each. `merge` is
     deliberately false: in feature scope it means nothing and must be ignored. */
  function mkScopeBoss(){ id=0; const out=[];
    const s1=sk([rect({x:-6,y:-6},{x:22,y:6})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'plate',sketchId:s1.id,depth:2,merge:true}));
    const s2=sk([circ({x:0,y:0},2)]); out.push(s2);
    const boss=F({id:ID(),type:'extrude',name:'boss',sketchId:s2.id,depth:5,merge:true});
    out.push(boss);
    out.push(F({id:ID(),type:'lpattern',name:'p',dir:'X',count:4,spacing:6,
                merge:false,scope:[boss.id]}));
    return out; }
  /* Two features in one scope. plate 1920, two bosses of 27π, two bores of 6π:
     1920 + 42π = 2051.947. Cut the copied bore BEFORE fusing the copied boss and
     the boss fills it straight back in, giving 1920 + 48π = 2070.796 — which is
     what makes this the case that pins the ordering down. */
  function mkScopeMirror(){ id=0; const out=[];
    const s1=sk([rect({x:-20,y:-8},{x:20,y:8})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'plate',sketchId:s1.id,depth:3,merge:true}));
    const s2=sk([circ({x:10,y:0},3)]); out.push(s2);
    const boss=F({id:ID(),type:'extrude',name:'boss',sketchId:s2.id,depth:6,merge:true});
    out.push(boss);
    const s3=sk([circ({x:10,y:0},1)]); out.push(s3);
    const bore=F({id:ID(),type:'cut',name:'bore',sketchId:s3.id,depth:3,through:true,flip:true});
    out.push(bore);
    out.push(F({id:ID(),type:'mirror',name:'m',plane:'Right',merge:false,
                scope:[boss.id,bore.id]}));
    return out; }
  function mkFilletRun(){ id=0; const out=[];
    const s1=sk([rect({x:-8,y:-5},{x:8,y:5})]); out.push(s1);
    out.push(F({id:ID(),type:'extrude',name:'a',sketchId:s1.id,depth:4,merge:true}));
    const s2=sk([circ({x:0,y:0},3)],'Front'); out.push(s2);
    out.push(F({id:ID(),type:'extrude',name:'boss',sketchId:s2.id,depth:6,symmetric:true,merge:true}));
    const s3=sk([circ({x:0,y:0},1.5)],'Front'); out.push(s3);
    out.push(F({id:ID(),type:'cut',name:'bore',sketchId:s3.id,depth:3,through:true,flip:true}));
    const s4=sk([circ({x:5,y:3},1)]); out.push(s4);
    out.push(F({id:ID(),type:'cut',name:'hole',sketchId:s4.id,depth:3,through:true,flip:true}));
    return out; }

  const PILLOW=[
    {"id":1,"type":"sketch","name":"Base profile","plane":{"kind":"datum","name":"Top"},"entities":[{"type":"rect","a":{"x":-7,"y":-4.5},"b":{"x":7,"y":4.5}}],"fillet":0,"chamfer":0,"suppressed":false},
    {"id":2,"type":"extrude","name":"Base","sketchId":1,"depth":2.5,"symmetric":false,"flip":false,"merge":true,"suppressed":false},
    {"id":3,"type":"fillet","name":"Corner fillets","kind":"fillet","r":1.2,"propagate":true,"seeds":[{"mid":[-7,1.25,4.5],"dir":[0,-1,0]},{"mid":[7,1.25,4.5],"dir":[0,1,0]},{"mid":[7,1.25,-4.5],"dir":[0,1,0]},{"mid":[-7,1.25,-4.5],"dir":[0,1,0]}],"suppressed":false},
    {"id":4,"type":"sketch","name":"Boss profile","plane":{"kind":"datum","name":"Front"},"entities":[{"type":"circle","c":{"x":0,"y":4.5},"r":3}],"fillet":0,"chamfer":0,"suppressed":false},
    {"id":5,"type":"extrude","name":"Bearing boss","sketchId":4,"depth":5,"symmetric":true,"flip":false,"merge":true,"suppressed":false},
    {"id":6,"type":"fillet","name":"Boss blend","kind":"fillet","r":0.6,"propagate":true,"seeds":[{"mid":[-2.23607,2.5,0],"dir":[0,0,1]},{"mid":[0,2.5,-2.5],"dir":[-1,0,0]},{"mid":[2.23607,2.5,0],"dir":[0,0,1]},{"mid":[0,2.5,2.5],"dir":[-1,0,0]}],"suppressed":false},
    {"id":7,"type":"sketch","name":"Bore profile","plane":{"kind":"datum","name":"Front"},"entities":[{"type":"circle","c":{"x":0,"y":4.5},"r":1.8}],"fillet":0,"chamfer":0,"suppressed":false},
    {"id":8,"type":"cut","name":"Bore","sketchId":7,"depth":3,"through":true,"flip":true,"suppressed":false},
    {"id":9,"type":"fillet","name":"Bore chamfers","kind":"chamfer","r":0.35,"propagate":true,"seeds":[{"mid":[-1.24047,3.20446,2.5],"dir":[-0.72229,0.69159,0]},{"mid":[-1.24047,3.20446,-2.5],"dir":[0.72229,-0.69159,0]}],"suppressed":false},
    {"id":10,"type":"sketch","name":"Bolt holes","plane":{"kind":"datum","name":"Top"},"entities":[{"type":"circle","c":{"x":-5.5,"y":0},"r":0.8},{"type":"circle","c":{"x":5.5,"y":0},"r":0.8}],"fillet":0,"chamfer":0,"suppressed":false},
    {"id":11,"type":"cut","name":"Bolt holes cut","sketchId":10,"depth":3,"through":true,"flip":true,"suppressed":false}
  ];

  function props(shapes){
    let vol=0, cx=0, cy=0, cz=0, faces=0, edges=0;
    for(const s of shapes){
      const g=new oc.GProp_GProps_1();
      // FIVE arguments — (shape, props, Eps, onlyClosed, skipShared)
      oc.BRepGProp.VolumeProperties_1(s, g, 1e-4, false, false);
      const m=g.Mass(), c=g.CentreOfMass();
      vol+=m; cx+=c.X()*m; cy+=c.Y()*m; cz+=c.Z()*m;
      let ex=new oc.TopExp_Explorer_2(s,oc.TopAbs_ShapeEnum.TopAbs_FACE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      for(;ex.More();ex.Next())faces++;
      ex=new oc.TopExp_Explorer_2(s,oc.TopAbs_ShapeEnum.TopAbs_EDGE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      for(;ex.More();ex.Next())edges++;
    }
    const bb=shapes.length?OCK.bounds(shapes[0]):null;
    return { vol:+vol.toFixed(3),
             com:[+(cx/vol).toFixed(3),+(cy/vol).toFixed(3),+(cz/vol).toFixed(3)],
             faces, edges, bodies:shapes.length,
             bbox:bb?[bb.min.map(v=>+v.toFixed(3)),bb.max.map(v=>+v.toFixed(3))]:null };
  }
  function run(list){
    const t0=performance.now(); let r;
    try{ const out=C.buildPartShapes(list); r=props(out.shapes); r.errs=out.errs; }
    catch(e){ r={fail:(e&&e.message)||String(e)}; }
    r.ms=Math.round(performance.now()-t0); return r;
  }

  const res={};
  /* third element, where there is one, is the analytic volume */
  for(const [n,l,want] of [['pillow',PILLOW],['order',mkOrder()],['multibody',mkMultibody()],
                      ['mirror',mkMirror()],['cpattern',mkCPattern()],['lpattern',mkLPattern()],
                      ['filletrun',mkFilletRun()],
                      ['scopecut',mkScopeCut(),815.243],
                      ['scopeboss',mkScopeBoss(),822.796],
                      ['scopemirror',mkScopeMirror(),2051.947]]){
    const r=run(l); res[n]=r;
    if(want!=null){ r.want=want;
      r.ok = r.vol!=null && Math.abs(r.vol-want)<0.01 && r.bodies===1 && !(r.errs||[]).length; }
  }
  fetch('models/lantern-rocket.sketchcad').then(r=>r.json()).then(list=>{
    res.lantern=run(list); window.__VER=res;
  }).catch(e=>{ res.lantern={fail:'fetch: '+e.message}; window.__VER=res; });
})();
'started — read window.__VER';

/* Expected as of the "rebindable keyboard shortcuts" commit:
 *   pillow     378.712  | 27f 144e 1b
 *   order      4840.383 | 25f 142e 1b     <- 4840, NOT ~4697: the plug survived
 *   multibody  1800     | 12f  48e 2b     <- TWO bodies
 *   mirror     608      | 26f 120e 1b
 *   cpattern   572.947  | 37f 190e 1b
 *   lpattern   156      | 30f 120e 1b
 *   filletrun  655.708  | 12f  68e 1b
 *   lantern    11268.126| 32f 164e 1b     <- see the VolumeProperties warning
 *
 * And the three scoped cases, which are right or wrong rather than merely
 * changed — check `ok` on each:
 *   scopecut    815.243 = 259.5π  |  9f 42e 1b   bbox is still the disc's own
 *   scopeboss   822.796 = 672+48π | 18f 56e 1b
 *   scopemirror 2051.947= 1920+42π| 14f 52e 1b   com x = 0
 */
