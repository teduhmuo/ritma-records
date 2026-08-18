/* ==========================================================================
   Ritma Records — mark a message as read/done (Netlify Function)
   ==========================================================================
   Passcode protected. Lets the dashboard track which requests/contact
   messages have actually been dealt with.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { markMessageStatus } = require('./lib/messages');

const VALID_STATUSES = ['new', 'read', 'done'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!passcodeConfigured()) {
    return { statusCode: 200, body: JSON.stringify({ status: 'not_configured' }) };
  }
  if (!checkPasscode(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect passcode.' }) };
  }

  try {
    const { id, status } = JSON.parse(event.body || '{}');
    if (!id || !VALID_STATUSES.includes(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid id/status.' }) };
    }

    const updated = await markMessageStatus(id, status);
    if (!updated) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Message not found.' }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok', message: updated }) };
  } catch (err) {
    console.error('[Ritma] update-message-status error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not update message.' }) };
  }
};
