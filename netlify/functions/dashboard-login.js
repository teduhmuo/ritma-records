/* ==========================================================================
   Ritma Records — dashboard login (Netlify Function)
   ==========================================================================
   Checks a submitted passcode against DASHBOARD_PASSCODE. On success the
   client just remembers that exact passcode (in sessionStorage) and resends
   it as a header on every later admin request — see lib/auth.js.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!passcodeConfigured()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_configured' })
    };
  }

  const ok = checkPasscode(event);
  return {
    statusCode: ok ? 200 : 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok })
  };
};
