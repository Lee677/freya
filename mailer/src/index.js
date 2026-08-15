/* freya-contact — the Worker behind the forms on freya.co.nz.
 *
 *   POST /api/contact   the "say hello" form on the home page
 *   POST /api/lead      the free-pilot form on /nextround
 *
 * Both post into my inbox through Cloudflare Email Routing, so no third party
 * sees a message. The recipient never appears in this repo, in the site's HTML,
 * or in any response body: it is a Worker secret. Reply-To is set to whoever
 * filled the form in, so replying from the inbox goes straight back to them.
 */
import { EmailMessage } from 'cloudflare:email';

const LIMITS = { name: 120, venue: 160, email: 200, message: 5000 };
const MIN_FILL_MS = 2500;   // humans do not complete a form this fast

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

// a header value must never carry a newline, or a sender could inject headers
const header = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
// "freya <hello@freya.co.nz>" -> "hello@freya.co.nz"
const bare = (s) => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); };
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

async function send(env, { subject, text, replyTo }) {
  const to = env.CONTACT_TO, from = env.CONTACT_FROM;
  if (!to || !from) return json({ error: 'The form is not connected yet. Try again shortly.' }, 503);
  const raw =
    `From: ${header(from)}\r\n` +
    `To: ${header(to)}\r\n` +
    `Reply-To: ${header(replyTo)}\r\n` +
    `Subject: ${header(subject)}\r\n` +
    `Message-ID: <${crypto.randomUUID()}@freya.co.nz>\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n\r\n` +
    text;
  try {
    await env.SEB.send(new EmailMessage(bare(from), bare(to), raw));
    return json({ ok: true });
  } catch (err) {
    console.error('send_email', err && err.message);
    return json({ error: 'The message could not be sent just now. Try again shortly.' }, 502);
  }
}

// shared spam handling: an invisible field, and a floor on how fast a form
// can plausibly be filled in
function spam(body) {
  if (clean(body.fax, 200)) return 'drop';
  const ms = Number(body.elapsed);
  if (ms >= 0 && ms < MIN_FILL_MS) return 'fast';
  return null;
}

async function contact(body, request, env) {
  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email);
  const message = clean(body.message, LIMITS.message);

  const s = spam(body);
  if (s === 'drop') return json({ ok: true });          // quietly accept and drop
  if (s === 'fast') return json({ error: 'That was quick — give it a moment and send again.' }, 429);
  if (!looksLikeEmail(email)) return json({ error: 'That email address does not look right.' }, 400);
  if (message.length < 5) return json({ error: 'A few more words, please.' }, 400);

  return send(env, {
    replyTo: email,
    subject: `freya.co.nz — ${name || email}`,
    text:
      `${message}\n\n` +
      `— — —\n` +
      `from: ${name ? name + ' <' + email + '>' : email}\n` +
      `sent: ${new Date().toISOString()}\n` +
      `via:  freya.co.nz/#contact (${request.headers.get('cf-ipcountry') || '??'})\n`
  });
}

async function lead(body, request, env) {
  const name = clean(body.name, LIMITS.name);
  const venue = clean(body.venue, LIMITS.venue);
  const email = clean(body.email, LIMITS.email);

  const s = spam(body);
  if (s === 'drop') return json({ ok: true });
  if (s === 'fast') return json({ error: 'That was quick — give it a moment and send again.' }, 429);
  if (!looksLikeEmail(email)) return json({ error: 'That email address does not look right.' }, 400);

  return send(env, {
    replyTo: email,
    subject: `NextRound pilot — ${venue || name || email}`,
    text:
      `A venue registered for the free pilot.\n\n` +
      `venue: ${venue || '(not given)'}\n` +
      `name:  ${name || '(not given)'}\n` +
      `email: ${email}\n\n` +
      `— — —\n` +
      `sent: ${new Date().toISOString()}\n` +
      `via:  freya.co.nz/nextround (${request.headers.get('cf-ipcountry') || '??'})\n` +
      `src:  ${clean(body.src, 80) || 'nextround'}\n`
  });
}

const ROUTES = { '/api/contact': contact, '/api/lead': lead };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const handler = ROUTES[path];
    if (!handler) return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

    // same-origin only; a browser always sends Origin on a cross-site POST
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin.' }, 403);
      } catch { return json({ error: 'Bad origin.' }, 403); }
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Malformed request.' }, 400); }

    return handler(body, request, env);
  }
};
