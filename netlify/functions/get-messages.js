/* ==========================================================================
   Ritma Records — fetch messages for the dashboard (Netlify Function)
   ==========================================================================
   Passcode protected — Request Item and Contact Us submissions contain
   customer emails and personal messages, same sensitivity level as the
   revenue dashboard.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { listMessages } = require('./lib/messages');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!passcodeConfigured()) {
    return { statusCode: 200, body: JSON.stringify({ status: 'not_configured' }) };
  }
  if (!checkPasscode(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect passcode.' }) };
  }

  try {
    const messages = await listMessages();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(messages)
    };
  } catch (err) {
    console.error('[Ritma] get-messages error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load messages.' }) };
  }
};
