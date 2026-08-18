/* ==========================================================================
   Ritma Records — live stock lookup (Netlify Function)
   ==========================================================================
   Returns current stock counts from Netlify Blobs, overlaying whatever
   real sales have decremented since products.json was last hand-edited.

   GET /.netlify/functions/get-stock              -> every product
   GET /.netlify/functions/get-stock?ids=1,2,3     -> just those ids

   Called by js/app.js on every page load and merged into the in-memory
   PRODUCTS array. If this call fails for any reason, the frontend falls
   back to the static `stock` values in products.json rather than breaking.
   ========================================================================== */

const { getLiveStockMap } = require('./lib/inventory');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const idsParam = event.queryStringParameters && event.queryStringParameters.ids;
    const ids = idsParam
      ? idsParam.split(',').map(v => Number(v.trim())).filter(n => !Number.isNaN(n))
      : null;

    const stock = await getLiveStockMap(ids);

    return {
      statusCode: 200,
      // Stock changes with every sale — never let a CDN/browser cache this.
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ stock })
    };
  } catch (err) {
    console.error('[Ritma] get-stock error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load stock levels.' }) };
  }
};
