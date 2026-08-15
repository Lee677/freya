/* POST /api/contact — takes the form on the home page and mails it to me.
 *
 * The destination address is never in this repo and never in the HTML; it lives
 * in the Pages project's environment variables. Configure ONE of:
 *
 *   a) Cloudflare Email Routing, no third party, nothing to sign up for:
 *      add a "send_email" binding named SEB whose destination address is the
 *      verified address you want the mail to land in, plus CONTACT_FROM
 *      (an address on freya.co.nz) and CONTACT_TO (the same verified address).
 *
 *   b) Resend: set RESEND_API_KEY (encrypted), CONTACT_FROM (a verified sender
 *      on freya.co.nz, e.g. "Freya <hello@freya.co.nz>") and CONTACT_TO.
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
    if (env.SEB) {
      const { EmailMessage } = await import('cloudflare:email');
      const raw =
        `From: ${header(from)}\r\n` +
        `To: ${header(to)}\r\n` +
        `Reply-To: ${header(email)}\r\n` +
        `Subject: ${subject}\r\n` +
        `Message-ID: <${crypto.randomUUID()}@freya.co.nz>\r\n` +
        `Date: ${new Date().toUTCString()}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        text;
      await env.SEB.send(new EmailMessage(addressOnly(from), addressOnly(to), raw));
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

// "Freya <hello@freya.co.nz>" -> "hello@freya.co.nz"
function addressOnly(s) {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim();
}

export const onRequestGet = () => json({ error: 'POST only.' }, 405);
