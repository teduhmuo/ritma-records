/* ==========================================================================
   Ritma Records — update order fulfilment status (Netlify Function)
   ==========================================================================
   Passcode protected (lib/auth.js). Handles the two fulfilment steps that
   happen after an order is paid:

     - action: 'ship'            -> requires a trackingLink (a full URL the
       customer can click). Only valid for deliveryMethod 'shipping'.
       Sends sendShippedEmail.
     - action: 'ready_for_pickup' -> no extra fields needed. Only valid for
       deliveryMethod 'pickup'. Sends sendReadyForPickupEmail.

   Both require the order to currently be 'paid' — you can't ship/ready an
   order that hasn't been paid yet, and re-running either action on an
   order already in that state just re-sends the email rather than erroring
   (useful if the customer says they never got it).
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { getOrder, markOrderStatus } = require('./lib/inventory');
const { sendShippedEmail, sendReadyForPickupEmail } = require('./lib/order-emails');

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
    const { orderNumber, action, trackingLink } = JSON.parse(event.body || '{}');
    if (!orderNumber || !['ship', 'ready_for_pickup'].includes(action)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid orderNumber/action.' }) };
    }

    const order = await getOrder(orderNumber);
    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found.' }) };
    }
    if (!['paid', 'shipped', 'ready_for_pickup'].includes(order.status)) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Order must be paid before it can be shipped or marked ready for pickup.' }) };
    }

    if (action === 'ship') {
      if (order.deliveryMethod !== 'shipping') {
        return { statusCode: 400, body: JSON.stringify({ error: 'This order is self-pickup, not shipping.' }) };
      }
      if (!trackingLink || !/^https?:\/\//i.test(trackingLink.trim())) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a valid tracking link (starting with http:// or https://).' }) };
      }

      const updated = await markOrderStatus(orderNumber, 'shipped', { trackingLink: trackingLink.trim() });
      try {
        const result = await sendShippedEmail(updated);
        console.log(`[Ritma] Order ${orderNumber} shipped email:`, result);
      } catch (emailErr) {
        console.error(`[Ritma] Order ${orderNumber} shipped email failed:`, emailErr);
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok', order: updated }) };
    }

    // action === 'ready_for_pickup'
    if (order.deliveryMethod !== 'pickup') {
      return { statusCode: 400, body: JSON.stringify({ error: 'This order is being shipped, not self-pickup.' }) };
    }

    const updated = await markOrderStatus(orderNumber, 'ready_for_pickup');
    try {
      const result = await sendReadyForPickupEmail(updated);
      console.log(`[Ritma] Order ${orderNumber} ready-for-pickup email:`, result);
    } catch (emailErr) {
      console.error(`[Ritma] Order ${orderNumber} ready-for-pickup email failed:`, emailErr);
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok', order: updated }) };
  } catch (err) {
    console.error('[Ritma] admin-update-order-fulfilment error:', err);
    // TEMPORARY: surfacing the real error message directly in the response
    // to debug faster — revert this to a generic message once confirmed
    // working, so internal error details aren't exposed long-term.
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not update order: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
