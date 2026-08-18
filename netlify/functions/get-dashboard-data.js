/* ==========================================================================
   Ritma Records — dashboard data (Netlify Function)
   ==========================================================================
   Backs dashboard.html: per-SKU units sold + revenue (from paid orders),
   live stock levels, and a recent-orders feed. All aggregation logic lives
   in netlify/functions/lib/inventory.js — this is just the HTTP wrapper.

   Now passcode-protected (lib/auth.js). This page used to be intentionally
   left open (unlisted URL only) — that changed the moment the dashboard
   gained a Products tab that can write to the storefront, so the whole
   page now sits behind one shared passcode rather than splitting the two
   tabs into different trust levels.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { getDashboardData } = require('./lib/inventory');

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
    const data = await getDashboardData();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('[Ritma] get-dashboard-data error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load dashboard data.' }) };
  }
};
