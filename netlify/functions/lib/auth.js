/* ==========================================================================
   Ritma Records — dashboard passcode check
   ==========================================================================
   One shared secret (DASHBOARD_PASSCODE env var, set in Netlify's site
   settings — never in code), sent by the client as an
   'x-dashboard-passcode' header and checked on every protected request.

   No sessions, no tokens, no expiry — deliberately simple for a one-person
   admin tool. This keeps casual/accidental visitors from writing to the
   storefront; it is not meant to withstand a determined, targeted attacker.
   ========================================================================== */

function passcodeConfigured() {
  return Boolean(process.env.DASHBOARD_PASSCODE);
}

function checkPasscode(event) {
  const expected = process.env.DASHBOARD_PASSCODE;
  if (!expected) return false; // fail closed if nobody's set one yet
  const headers = event.headers || {};
  const provided = headers['x-dashboard-passcode'] || headers['X-Dashboard-Passcode'] || '';
  return provided === expected;
}

module.exports = { checkPasscode, passcodeConfigured };
