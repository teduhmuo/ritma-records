/* ==========================================================================
   Ritma Records — Bayarcash webhook receiver (Netlify Function)
   ==========================================================================
   Bayarcash calls this URL server-to-server when a payment's status changes
   (paid, failed, pending). It's separate from the customer-facing return_url
   redirect so that order status updates don't depend on the customer's
   browser actually reaching the confirmation page.

   STATUS: order status, stock decrement, and emails are wired up, but the
   signature check below is still NOT done — do not treat this endpoint as
   trusted in production until step 1 is finished:

     1. Verify the callback signature using Bayarcash's documented
        verification method (see the PHP SDK's verifyTransactionCallbackData
        / verifyReturnUrlCallbackData for the expected approach) — do NOT
        trust an unverified callback body. Anyone who guesses this URL and
        an order number can currently mark an order "paid" without having
        paid anything.
     2. The exact field names Bayarcash sends for the order number and
        status haven't been confirmed against a real callback yet (no
        merchant account set up). The code below checks a few likely names
        (order_number/orderNumber, status/payment_status) — once a real
        webhook payload is seen, tighten this to the actual field names.

   WHAT HAPPENS ON A "PAID" CALLBACK:
   Looks up the order (saved by create-bayarcash-payment.js when the
   payment intent was created), decrements live stock for each line item,
   marks the order 'paid', and sends two emails — a receipt to the customer
   and a notification to you (see lib/order-emails.js and lib/email.js for
   the Resend setup and the "customer receipts need a verified sending
   domain" caveat). Guarded so a duplicate callback for the same order
   (payment gateways commonly retry) won't double-decrement stock or
   double-send emails.
   ========================================================================== */

const { getOrder, markOrderStatus, decrementStock } = require('./lib/inventory');
const { sendOrderConfirmationEmail, sendAdminNotificationEmail } = require('./lib/order-emails');

const PAID_STATUSES = ['paid', 'success', 'successful', 'completed'];
const FAILED_STATUSES = ['failed', 'cancelled', 'canceled', 'declined'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    console.log('[Ritma] Bayarcash webhook received:', payload);

    // TODO: verify signature/checksum before trusting this payload (see above).

    const orderNumber = payload.order_number || payload.orderNumber;
    const rawStatus = String(payload.status || payload.payment_status || '').toLowerCase();

    if (!orderNumber) {
      console.warn('[Ritma] Webhook payload missing an order number, ignoring.');
      return { statusCode: 200, body: 'OK' };
    }

    const order = await getOrder(orderNumber);
    if (!order) {
      console.warn(`[Ritma] Webhook referenced unknown order ${orderNumber}, ignoring.`);
      return { statusCode: 200, body: 'OK' };
    }

    if (PAID_STATUSES.includes(rawStatus)) {
      // Idempotency: only decrement/email once per order, even if Bayarcash
      // retries this callback.
      if (order.status !== 'paid') {
        await decrementStock(order.items);
        const paidOrder = await markOrderStatus(orderNumber, 'paid');
        console.log(`[Ritma] Order ${orderNumber} marked paid, stock decremented.`);

        // Email failures must never fail the webhook itself — the order is
        // already correctly paid/decremented regardless of whether mail
        // sends. See lib/email.js for why one of these two can legitimately
        // fail until a sending domain is verified.
        try {
          const [customerResult, adminResult] = await Promise.all([
            sendOrderConfirmationEmail(paidOrder),
            sendAdminNotificationEmail(paidOrder)
          ]);
          console.log(`[Ritma] Order ${orderNumber} emails:`, { customerResult, adminResult });
        } catch (emailErr) {
          console.error(`[Ritma] Order ${orderNumber} email sending threw unexpectedly:`, emailErr);
        }
      } else {
        console.log(`[Ritma] Order ${orderNumber} already marked paid, skipping re-decrement/re-email.`);
      }
    } else if (FAILED_STATUSES.includes(rawStatus)) {
      if (order.status === 'pending') {
        await markOrderStatus(orderNumber, 'failed');
        console.log(`[Ritma] Order ${orderNumber} marked failed.`);
      }
    } else {
      console.log(`[Ritma] Order ${orderNumber} status "${rawStatus}" not recognised as paid/failed, no action taken.`);
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('[Ritma] Webhook parse error:', err);
    return { statusCode: 400, body: 'Bad request' };
  }
};
