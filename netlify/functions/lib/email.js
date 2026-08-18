/* ==========================================================================
   Ritma Records — email sending (Resend)
   ==========================================================================
   Talks to Resend's HTTP API directly (no SDK needed, just fetch). Reads
   RESEND_API_KEY from environment variables; if it's missing, every send
   is a silent no-op rather than an error — the rest of the order flow
   (stock decrement, order status, dashboard) must never break just because
   email isn't set up yet.

   SENDER DOMAIN NOTE — this matters, read before assuming it's broken:
   Until ritmarecords.com is verified as a sending domain in Resend, mail
   can only go out "from" onboarding@resend.dev, and Resend will only
   actually deliver those to the email address the Resend account itself
   was signed up with. That's enough for the admin notification (goes to
   you) but NOT customer receipts (goes to whoever bought something) —
   those will fail silently (logged, not thrown) until the domain is
   verified. See README for the DNS records that unlock it.
   ========================================================================== */

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Ritma] RESEND_API_KEY not set — skipping email:', subject);
    return { sent: false, reason: 'not_configured' };
  }

  const from = process.env.RESEND_FROM || 'Ritma Records <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[Ritma] Resend rejected "${subject}" to ${to}:`, res.status, errBody);
      return { sent: false, reason: 'rejected', status: res.status };
    }

    return { sent: true };
  } catch (err) {
    console.error(`[Ritma] Email send failed for "${subject}" to ${to}:`, err);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { sendEmail };
