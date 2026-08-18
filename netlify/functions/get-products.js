/* ==========================================================================
   Ritma Records — product catalog (Netlify Function)
   ==========================================================================
   Public, no passcode — the storefront needs this to load for everyone.
   Returns every product from Supabase, stock included directly (no
   separate merge step needed anymore — stock lives on the product row
   itself now, not a second Blobs store like before).
   ========================================================================== */

const { getAllProducts } = require('./lib/catalog');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const products = await getAllProducts();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(products)
    };
  } catch (err) {
    console.error('[Ritma] get-products error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load products.' }) };
  }
};
