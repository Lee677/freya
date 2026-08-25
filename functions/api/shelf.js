/* The shelf: gives a just-exported model a URL for ten minutes, which is the
 * one thing a slicer's url-scheme needs — Bambu Studio (and Orca, and Prusa)
 * can only FETCH A HOSTED FILE, never receive one from the page. Deployed
 * automatically with the site as a Cloudflare Pages Function; storage is the
 * KV namespace bound as SHELF (see wrangler.toml). Without the binding every
 * request 503s and the app quietly falls back to download-then-launch.
 *
 * POST /api/shelf   body = the 3MF bytes  ->  {url}
 *   - 8 MB cap: a bin or a case is well under 1 MB; nobody "shares" here.
 *   - 10 minute TTL via KV expiration; nothing is ever listed or extended.
 *   - id is 128 random bits, which IS the privacy model: unguessable, unlisted,
 *     gone in ten minutes.
 */
const MAX = 8 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (!env.SHELF)
    return new Response('shelf not configured', { status: 503 });
  const len = +(request.headers.get('content-length') || 0);
  if (len > MAX) return new Response('too big', { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX)
    return new Response('too big', { status: 413 });
  const id = [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  await env.SHELF.put('m:' + id, bytes, { expirationTtl: 600 });
  const url = new URL(request.url);
  return Response.json({ url: url.origin + '/api/shelf/' + id + '.3mf' });
}
