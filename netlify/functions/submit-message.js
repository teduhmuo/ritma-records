/* ==========================================================================
   Ritma Records — submit a Request Item or Contact Us message (Netlify Function)
   ==========================================================================
   Public, no passcode — anyone browsing the storefront can submit these.
   Replaces Netlify Forms for these two forms specifically — see
   lib/messages.js for why (dashboard visibility).

   Honeypot: reuses the existing hidden 'bot-field' input already on both
   forms. If it's filled in, a bot filled it (real visitors never see it —
   it's CSS-hidden), so this returns a normal-looking success response
   without actually saving anything or sending an email. Never tell a bot
   it's been caught; that just teaches it to adapt.
   ========================================================================== */

const { saveMessage } = require('./lib/messages');
const { sendMessageNotificationEmail } = require('./lib/message-emails');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { type, name, email, botField } = body;

    // Honeypot tripped — pretend success, save nothing.
    if (botField) {
      return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
    }

    if (type !== 'request' && type !== 'contact') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid submission type.' }) };
    }
    if (!name || !String(name).trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name is required.' }) };
    }
    if (!email || !String(email).trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email is required.' }) };
    }

    if (type === 'request') {
      if (!body.item || !String(body.item).trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Please tell us what you\'re looking for.' }) };
      }
    } else {
      if (!body.message || !String(body.message).trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Please include a message.' }) };
      }
    }

    const saved = await saveMessage({
      type,
      name: String(name).trim(),
      email: String(email).trim(),
      format: body.format,
      item: body.item ? String(body.item).trim() : null,
      details: body.details ? String(body.details).trim() : null,
      orderNumber: body.orderNumber ? String(body.orderNumber).trim() : null,
      message: body.message ? String(body.message).trim() : null
    });

    // Same resilience pattern as order emails — a notification failure must
    // never fail the submission itself; the message is already saved and
    // visible in the dashboard regardless of whether the email goes out.
    try {
      await sendMessageNotificationEmail(saved);
    } catch (emailErr) {
      console.error('[Ritma] Message notification email failed:', emailErr);
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok' }) };
  } catch (err) {
    console.error('[Ritma] submit-message error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
