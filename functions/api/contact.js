/* POST /api/contact — takes the form on the home page and mails it to me.
 *
 * The destination address is never in this repo and never in the HTML; it lives
 * in the Pages project's secrets. CONTACT_TO and CONTACT_FROM are already set.
 * What remains is a way to actually put the message in a mailbox — set either:
 *
 *   RESEND_API_KEY  — encrypted secret; sender must be a verified domain
 *                     (freya.co.nz), which is what CONTACT_FROM is for.
 *
 *   MAILER          — a service binding to a small Worker that holds a
 *                     send_email binding. Pages Functions cannot carry a
 *                     send_email binding themselves, so Cloudflare Email
 *                     Routing has to be reached through a Worker. Not wired up
 *                     yet; the branch below is deliberately absent rather than
 *                     present-and-broken.
 *
 * With neither set the endpoint answers 503 and says so plainly, rather than
 * pretending a message was delivered.
 */

const LIMITS = { name: 120, email: 200, message: 5000 };
const MIN_FILL_MS = 2500;   // humans do not complete a form this fast

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

// header values must never carry a newline, or a sender could inject headers
const header = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

export async function onRequestPost({ request, env }) {
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

  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!to || !from) {
    return json({ error: 'The form is not connected yet. Try again shortly.' }, 503);
  }

  const subject = header(`freya.co.nz — ${name ? name : email}`);
  const country = request.headers.get('cf-ipcountry') || '??';
  const text =
    `${message}\n\n` +
    `— — —\n` +
    `from: ${name ? name + ' <' + email + '>' : email}\n` +
    `sent: ${new Date().toISOString()}\n` +
    `via:  freya.co.nz/#contact (${country})\n`;

  try {
    if (env.MAILER) {
      const r = await env.MAILER.fetch('https://mailer/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, replyTo: email, subject, text })
      });
      if (!r.ok) {
        console.error('mailer', r.status, await r.text().catch(() => ''));
        return json({ error: 'The message could not be sent just now. Try again shortly.' }, 502);
      }
      return json({ ok: true });
    }

    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ from, to: [to], reply_to: email, subject, text })
      });
      if (!r.ok) {
        console.error('resend', r.status, await r.text().catch(() => ''));
        return json({ error: 'The message could not be sent just now. Try again shortly.' }, 502);
      }
      return json({ ok: true });
    }
  } catch (err) {
    console.error('contact', err && err.message);
    return json({ error: 'The message could not be sent just now. Try again shortly.' }, 502);
  }

  return json({ error: 'The form is not connected yet. Try again shortly.' }, 503);
}

export const onRequestGet = () => json({ error: 'POST only.' }, 405);
