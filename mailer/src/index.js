/* freya-contact — takes the home page's contact form and posts it into my
 * inbox through Cloudflare Email Routing. No third party sees the message.
 *
 * The recipient never appears in this repo, in the site's HTML, or in any
 * response body: it is a Worker secret, and the reply-to is set to whoever
 * filled the form in, so replying from the inbox goes straight back to them.
 */
import { EmailMessage } from 'cloudflare:email';

const LIMITS = { name: 120, email: 200, message: 5000 };
const MIN_FILL_MS = 2500;   // humans do not complete a form this fast

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

// a header value must never carry a newline, or a sender could inject headers
const header = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
// "Freya <hello@freya.co.nz>" -> "hello@freya.co.nz"
const bare = (s) => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); };

export default {
  async fetch(request, env) {
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

    const name = String(body.name || '').trim().slice(0, LIMITS.name);
    const email = String(body.email || '').trim().slice(0, LIMITS.email);
    const message = String(body.message || '').trim().slice(0, LIMITS.message);

    // honeypot: a real person never sees this field
    if (String(body.fax || '').trim()) return json({ ok: true });   // quietly accept and drop
    if (Number(body.elapsed) >= 0 && Number(body.elapsed) < MIN_FILL_MS) {
      return json({ error: 'That was quick — give it a moment and send again.' }, 429);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'That email address does not look right.' }, 400);
    if (message.length < 5) return json({ error: 'A few more words, please.' }, 400);

    const to = env.CONTACT_TO, from = env.CONTACT_FROM;
    if (!to || !from) return json({ error: 'The form is not connected yet. Try again shortly.' }, 503);

    const subject = header(`freya.co.nz — ${name || email}`);
    const country = request.headers.get('cf-ipcountry') || '??';
    const text =
      `${message}\n\n` +
      `— — —\n` +
      `from: ${name ? name + ' <' + email + '>' : email}\n` +
      `sent: ${new Date().toISOString()}\n` +
      `via:  freya.co.nz/#contact (${country})\n`;

    const raw =
      `From: ${header(from)}\r\n` +
      `To: ${header(to)}\r\n` +
      `Reply-To: ${header(email)}\r\n` +
      `Subject: ${subject}\r\n` +
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
};
