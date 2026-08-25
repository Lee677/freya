/* Writes freyacad/build-stamp.json at deploy time — the real deploy moment and
 * commit, for the boot panel's version line and the corner build tag.
 *
 * Exists because document.lastModified only reports the truth when the server
 * sends a Last-Modified header. Cloudflare Pages sends ETags instead, and the
 * browser's spec-mandated fallback is THE CURRENT TIME — so the "build" stamp
 * silently showed every visitor the moment their own tab loaded. The file is
 * gitignored; `npm run deploy` and the deploy workflow both regenerate it.
 */
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
let commit = '';
try { commit = execSync('git rev-parse --short HEAD', {encoding: 'utf8'}).trim(); } catch {}
const stamp = { t: new Date().toISOString(), commit };
writeFileSync(new URL('../freyacad/build-stamp.json', import.meta.url),
  JSON.stringify(stamp) + '\n');
console.log('build-stamp:', stamp.t, commit);
