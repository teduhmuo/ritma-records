/* ==========================================================================
   Ritma Records — manually mark an order as paid (Netlify Function)
   ==========================================================================
   Passcode protected (lib/auth.js). This is the manual-bank-transfer
   equivalent of what bayarcash-webhook.js does automatically: once the
   admin has checked Maybank and matched an incoming transfer to an order
   number, this decrements stock, flips the order to 'paid', and sends the
   customer their order confirmation email — the same one a real gateway
   payment would trigger.

   Guarded the same way as the webhook: calling this twice on an
   already-paid order is a safe no-op, so an accidental double-click can't
   double-decrement stock or double-email the customer.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { getOrder, markOrderStatus, decrementStock } = require('./lib/inventory');
const { sendOrderConfirmationEmail } = require('./lib/order-emails');

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
    const { orderNumber } = JSON.parse(event.body || '{}');
    if (!orderNumber) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing orderNumber.' }) };
    }

    const order = await getOrder(orderNumber);
    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found.' }) };
    }

    if (order.status === 'paid') {
      // Already handled — nothing more to do, but not an error.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ok', order, alreadyPaid: true })
      };
    }

    await decrementStock(order.items);
    const paidOrder = await markOrderStatus(orderNumber, 'paid');
    console.log(`[Ritma] Order ${orderNumber} manually marked paid by admin, stock decremented.`);

    try {
      const result = await sendOrderConfirmationEmail(paidOrder);
      console.log(`[Ritma] Order ${orderNumber} customer confirmation email:`, result);
    } catch (emailErr) {
      console.error(`[Ritma] Order ${orderNumber} confirmation email failed:`, emailErr);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', order: paidOrder, alreadyPaid: false })
    };
  } catch (err) {
    console.error('[Ritma] admin-mark-order-paid error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not mark order as paid.' }) };
  }
};
