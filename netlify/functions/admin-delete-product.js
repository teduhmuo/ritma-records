/* ==========================================================================
   Ritma Records — delete a product (Netlify Function)
   ==========================================================================
   Passcode protected. Removes the product row from Supabase and its photo
   from Storage (see lib/catalog.js's deleteProduct — it looks up the
   stored image_path first, then removes that file).
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { getProduct, deleteProduct } = require('./lib/catalog');

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
    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing product id.' }) };
    }
    const existing = await getProduct(id);
    if (!existing) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Product not found.' }) };
    }
    await deleteProduct(id);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok' }) };
  } catch (err) {
    console.error('[Ritma] admin-delete-product error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not delete product.' }) };
  }
};
