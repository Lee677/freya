#!/usr/bin/env node
/* Run a freyacad dev suite in a headless browser instead of pasting it into a
 * console. Same page, same kernel, same code — the only difference is that
 * nobody has to be looking at it.
 *
 *   node dev/headless.js --script dev/verify.js
 *   node dev/headless.js --script dev/verify-live.js --global __VERLIVE
 *
 * It serves the site itself (--serve, default the freyacad/ parent) and prints
 * the suite's result global as JSON on stdout, so a run diffs against the
 * previous commit with plain files:
 *
 *   git stash push -- freyacad/index.html
 *   node dev/headless.js --script dev/verify.js > /tmp/base.json
 *   git stash pop
 *   node dev/headless.js --script dev/verify.js > /tmp/new.json
 *   diff /tmp/base.json /tmp/new.json
 *
 * WHY --occt EXISTS. The kernel is a 50 MB WASM blob that the page pulls from a
 * CDN. Behind an egress policy that blocks the CDN the page never starts, and
 * the suite cannot run at all. `npm i opencascade.js@2.0.0-beta.b5ff984` puts
 * the same build on disk; point --occt at its dist/ and every request for the
 * kernel is answered from there. Nothing in index.html changes — the redirect
 * is a Playwright route, so the page under test is byte-for-byte the shipped
 * one, which is the whole point of a regression run.
 *
 * Needs playwright-core and a chromium. Both are usually already about:
 *   npm i -D playwright-core   (or use the one under node_modules anywhere up-tree)
 *   PW_CHROMIUM=/path/to/chrome   if it is not found automatically
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');

function arg(name, dflt){
  const i = process.argv.indexOf('--'+name);
  return i > 0 && process.argv[i+1] ? process.argv[i+1] : dflt;
}
const HERE   = __dirname;                       // freyacad/dev
const APP    = path.dirname(HERE);              // freyacad
const script = path.resolve(arg('script', path.join(HERE,'verify.js')));
const glob   = arg('global', '__VER');
const root   = path.resolve(arg('serve', path.dirname(APP)));
const occt   = arg('occt', null) && path.resolve(arg('occt'));
const page0  = arg('page', '/' + path.basename(APP) + '/index.html');
const outArg = arg('out', null);

const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml',
  '.css':'text/css','.ico':'image/x-icon','.sketchcad':'application/json',
  '.asmcad':'application/json'};

/* Chromium: whatever playwright already downloaded, else PW_CHROMIUM. */
function findChromium(){
  if(process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  if(base && fs.existsSync(base)){
    const hit = fs.readdirSync(base).filter(d=>/^chromium-/.test(d)).sort().pop();
    if(hit) return path.join(base, hit, 'chrome-linux', 'chrome');
  }
  return undefined;      // let playwright resolve its own
}

(async () => {
  const { chromium } = require('playwright-core');

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'');
    const file = path.join(root, rel);
    if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('no');
    }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + page0;

  const browser = await chromium.launch({
    executablePath: findChromium(),
    /* SwiftShader: three.js still wants a WebGL context even though every
       number this measures comes from the kernel, not the renderer. */
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
           '--no-sandbox','--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport:{width:1400,height:900} });

  if(occt) await page.route(/opencascade\.full\.(js|wasm)/, route => {
    const f = path.join(occt, path.basename(new URL(route.request().url()).pathname));
    if(!fs.existsSync(f)) return route.abort();
    route.fulfill({ status:200, body: fs.readFileSync(f),
      headers:{'Content-Type': f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
               'Access-Control-Allow-Origin':'*'} });
  });

  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type()==='error') problems.push('console: ' + m.text()); });

  try{
    await page.goto(url, { waitUntil:'load', timeout:120000 });
    await page.waitForFunction('!!window.OCCT && !!window.__C', null, { timeout:240000 });
    await page.evaluate(fs.readFileSync(script,'utf8'));
    await page.waitForFunction(
      g => window[g] && window[g] !== 'running', glob, { timeout:600000 });
    const out = await page.evaluate(g => window[g], glob);
    const json = JSON.stringify(out, null, 1);
    if(outArg) fs.writeFileSync(outArg, json); else console.log(json);
    /* The CDN font/analytics requests a sandbox blocks are noise; a page error
       is not, so it goes to stderr where it cannot corrupt the JSON. */
    const real = problems.filter(p => !/ERR_TUNNEL|ERR_BLOCKED|favicon/.test(p));
    if(real.length) console.error(real.join('\n'));
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error('headless: ' + (e.stack||e.message)); process.exit(1); });
