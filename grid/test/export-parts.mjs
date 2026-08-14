/* Headless harness: runs the same geometry + exporter code the page runs and
 * writes real files, so the output can be checked against a CAD kernel.
 *   node test/export-parts.mjs [outdir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from '../manifold.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'out'));
fs.mkdirSync(out, { recursive: true });

globalThis.window = globalThis;
const wasm = await Module({
  locateFile: p => p.endsWith('.wasm') ? path.join(here, '..', 'manifold.wasm') : p
});
if (typeof wasm.setup === 'function') wasm.setup();
globalThis.MANIFOLD = wasm;

await import('../js/core.js');
await import('../js/exporters.js');
const { GF, EX } = globalThis;

const spanner = (() => {
  const p = [], L = 150, W = 13, hw = 26, hl = 34;
  const q = (x, y) => p.push([x, y]);
  q(-L / 2, -W / 2 + 3); q(-L / 2 + hl, -hw / 2); q(-L / 2 + hl + 6, -hw / 2);
  q(L / 2 - hl - 6, -W / 2); q(L / 2 - hl, -hw / 2 + 2); q(L / 2, -hw / 2 + 4);
  q(L / 2 + 2, 0); q(L / 2, hw / 2 - 4); q(L / 2 - hl, hw / 2 - 2);
  q(L / 2 - hl - 6, W / 2); q(-L / 2 + hl + 6, hw / 2); q(-L / 2 + hl, hw / 2); q(-L / 2, W / 2 - 3);
  return p;
})();

const cases = [
  ['baseplate_3x2_skirt', () => GF.buildBaseplate({ drawerW: 140, drawerD: 100, gap: 0.5, floor: 0, seg: 8 }).solid],
  ['baseplate_floor_relief', () => GF.buildBaseplate({ drawerW: 200, drawerD: 140, floor: 1.6, cornerRelief: 6, seg: 8 }).solid],
  ['bin_1x1x3', () => GF.buildBin({ nx: 1, ny: 1, uz: 3, lip: true, seg: 8 }).solid],
  ['bin_2x1x3_div_scoop', () => GF.buildBin({ nx: 2, ny: 1, uz: 3, lip: true, divX: 2, divY: 1, scoop: 8, seg: 8 }).solid],
  ['bin_tool_pocket', () => GF.buildBin({
    nx: 4, ny: 2, uz: 3, lip: true, seg: 8,
    pocket: { poly: spanner, depth: 12, clearance: 0.5, cols: 1, rows: 2, spacing: 4, fingerR: 9 }
  }).solid],
  ['photo_target', () => GF.buildTarget({ innerW: 200, innerD: 150, frameW: 12, thickness: 3 }).solid],
  ['stand_arm', () => GF.buildStand({}).parts[2].solid]
];

const report = [];
for (const [name, build] of cases) {
  GF.flush();
  const mesh = EX.toMesh(build());
  GF.flush();
  const st = EX.meshStats(mesh);
  const chk = EX.checkShell(mesh);
  const stl = Buffer.from(await EX.stl(mesh, name).arrayBuffer());
  const step = EX.step(mesh, name);
  const stepBuf = Buffer.from(await step.blob.arrayBuffer());
  fs.writeFileSync(path.join(out, name + '.stl'), stl);
  fs.writeFileSync(path.join(out, name + '.step'), stepBuf);
  report.push({
    name,
    size: [+st.x.toFixed(2), +st.y.toFixed(2), +st.z.toFixed(2)],
    volume_cm3: +(st.volume / 1000).toFixed(2),
    tris: mesh.nt, welded: mesh.welded,
    step_faces: step.faces, unpaired_edges: chk.unpaired,
    stl_kb: Math.round(stl.length / 1024), step_kb: Math.round(stepBuf.length / 1024)
  });
}
console.log(JSON.stringify(report, null, 1));
console.log('written to', out);
