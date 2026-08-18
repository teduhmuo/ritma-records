/* ==========================================================================
   Ritma Records — Bayarcash checkout (Netlify Function)
   ==========================================================================

   WHY THIS FILE EXISTS AS A SERVER FUNCTION (not client-side JS):
   Bayarcash payment requests must be signed with a checksum built from your
   API secret key. That secret can never be exposed in browser code — it has
   to be added here, on the server, as an environment variable.

   CURRENT STATUS: NOT CONFIGURED
   Ritma Records doesn't have a Bayarcash merchant account yet, so this
   function currently returns { status: "not_configured" } and the frontend
   shows an order total instead of redirecting to a real payment page.
   Nothing breaks — this is intentional and safe to deploy as-is.

   TO GO LIVE LATER:
   1. Sign up for a Bayarcash merchant account: https://bayar.cash
   2. In Netlify: Site settings → Environment variables, add:
        BAYARCASH_API_SECRET_KEY   (from your Bayarcash API/personal access token)
        BAYARCASH_PORTAL_KEY       (your Bayarcash portal/merchant key)
        BAYARCASH_MODE             ("sandbox" or "production")
        SITE_URL                   (e.g. https://ritmarecords.netlify.app)
   3. IMPORTANT — verify against the live docs before going to production:
        - Confirm the exact v3 endpoint path and checksum (HMAC) algorithm at
          https://docs.bayarcash.com and https://github.com/webimpian/bayarcash-api-documentation
        - Bayarcash publishes an official PHP SDK (webimpian/bayarcash-php-sdk)
          with a createPaymentIntentChecksumValue() helper — mirror its exact
          field order/algorithm here so checksums match what Bayarcash expects.
        - This scaffold uses the field names documented for payment intents
          (portal_key, order_number, amount, payer_name, payer_email,
          payer_telephone_number, payment_channel, callback_url, return_url)
          but the checksum function below is a placeholder — do not go live
          until it's verified against Bayarcash's official algorithm.
   4. Remove the early-return "not_configured" block below once verified.

   CUSTOMER DETAILS + SHIPPING (added):
   checkout.html now collects name/phone/email, a pickup-or-shipping choice,
   and a shipping address when relevant. Pricing is recomputed HERE from the
   live catalog rather than trusting whatever the client sends — an item's
   price, and the RM15 flat shipping fee, are both server-side constants so
   nobody can pay less by editing browser JS before hitting submit.

   STOCK CHECK + ORDER RECORD:
   Before creating the payment intent, the cart is checked against live
   stock (netlify/functions/lib/inventory.js) so nobody can pay for more
   than what's actually left. Once Bayarcash accepts the intent, the full
   order (items, computed total, customer + delivery details) is saved to
   the ritma-orders blob store — the webhook needs that record both to know
   what to decrement once payment is confirmed, and to send the receipt/
   notification emails with the right details, since Bayarcash's callback
   only carries the order number and status.
   ========================================================================== */

const crypto = require('crypto');
const { checkStockAvailable, saveOrder } = require('./lib/inventory');
const { getProduct } = require('./lib/catalog');

const SHIPPING_FEE = 15; // RM, flat rate nationwide — see checkout.html

// Sandbox vs production base URL for the Bayarcash v3 API.
// TODO: confirm these against current Bayarcash docs before going live.
const BAYARCASH_BASE_URL = {
  sandbox: 'https://api.console.bayarcash-sandbox.com/v3',
  production: 'https://api.console.bayar.cash/v3'
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { BAYARCASH_API_SECRET_KEY, BAYARCASH_PORTAL_KEY, BAYARCASH_MODE, SITE_URL } = process.env;

  try {
    const { items, payer, deliveryMethod, shippingAddress } = JSON.parse(event.body || '{}');

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing cart items.' }) };
    }
    if (!payer || !payer.name || !payer.phone || !payer.email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name, phone, and email are required.' }) };
    }
    if (deliveryMethod !== 'pickup' && deliveryMethod !== 'shipping') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please choose pickup or shipping.' }) };
    }
    if (deliveryMethod === 'shipping') {
      if (!shippingAddress || !shippingAddress.line1 || !shippingAddress.city || !shippingAddress.postcode || !shippingAddress.state) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a complete shipping address.' }) };
      }
    }

    // ---- Stock check: reject before charging anyone for a sold-out item ----
    const stockCheck = await checkStockAvailable(items);
    if (!stockCheck.ok) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Some items in your crate are no longer available in the quantity requested.',
          problems: stockCheck.problems
        })
      };
    }

    // ---- Recompute pricing server-side — never trust a client-sent total ----
    let subtotal = 0;
    const verifiedItems = [];
    for (const item of items) {
      const product = await getProduct(item.id);
      if (!product) {
        return { statusCode: 400, body: JSON.stringify({ error: `Item ${item.id} no longer exists.` }) };
      }
      const qty = Math.max(1, Number(item.qty) || 1);
      subtotal += product.price * qty;
      verifiedItems.push({ id: product.id, title: product.title, price: product.price, qty });
    }
    const shippingFee = deliveryMethod === 'shipping' ? SHIPPING_FEE : 0;
    const amount = Number((subtotal + shippingFee).toFixed(2));

    const orderNumber = `RR-${Date.now()}`;

    // ---- Persist the order — needed by the webhook for stock decrement,
    //      fulfilment details on the dashboard, and the confirmation emails.
    await saveOrder(orderNumber, {
      orderNumber,
      items: verifiedItems,
      subtotal: Number(subtotal.toFixed(2)),
      shippingFee,
      amount,
      deliveryMethod,
      shippingAddress: deliveryMethod === 'shipping' ? shippingAddress : null,
      payer,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // ---- Not configured yet: respond gracefully instead of erroring ----
    if (!BAYARCASH_API_SECRET_KEY || !BAYARCASH_PORTAL_KEY) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'not_configured', orderNumber, amount })
      };
    }

    const siteUrl = SITE_URL || `https://${event.headers.host}`;

    const payload = {
      portal_key: BAYARCASH_PORTAL_KEY,
      order_number: orderNumber,
      amount: amount.toFixed(2),
      payer_name: payer.name,
      payer_email: payer.email,
      payer_telephone_number: payer.phone,
      // payment_channel left unset here so Bayarcash shows all enabled
      // channels (FPX, DuitNow QR, cards, e-wallets) on their checkout page.
      callback_url: `${siteUrl}/.netlify/functions/bayarcash-webhook`,
      return_url: `${siteUrl}/order-confirmation.html?order=${orderNumber}`
    };

    payload.checksum = buildChecksum(payload, BAYARCASH_API_SECRET_KEY);

    const baseUrl = BAYARCASH_MODE === 'production' ? BAYARCASH_BASE_URL.production : BAYARCASH_BASE_URL.sandbox;

    // TODO: verify this is the correct v3 endpoint path before going live.
    const response = await fetch(`${baseUrl}/payment-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BAYARCASH_API_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      console.error('[Ritma] Bayarcash rejected the payment intent:', data);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Bayarcash could not create the payment. Please try again shortly.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', paymentUrl: data.url, orderNumber })
    };
  } catch (err) {
    console.error('[Ritma] Checkout function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error.' }) };
  }
};

/**
 * Placeholder checksum builder — modelled on the field list Bayarcash's
 * PHP SDK documents for createPaymentIntentChecksumValue(), but the exact
 * field order / HMAC algorithm has NOT been confirmed against Bayarcash's
 * live spec. Verify and replace before this goes to production.
 */
function buildChecksum(payload, secretKey) {
  const orderedFields = [
    payload.portal_key,
    payload.order_number,
    payload.amount,
    payload.payer_name,
    payload.payer_email,
    payload.payer_telephone_number
  ].join('');

  return crypto.createHmac('sha256', secretKey).update(orderedFields).digest('hex');
}
