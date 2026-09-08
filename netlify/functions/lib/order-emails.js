/* ==========================================================================
   Ritma Records — order email templates
   ==========================================================================
   Two emails, both fired only once an order is confirmed PAID (see
   bayarcash-webhook.js) — never at checkout/intent-creation, since the
   customer hasn't actually paid at that point and may abandon.
   ========================================================================== */

const { sendEmail } = require('./email');

function formatMYR(n) {
  return 'RM' + Number(n).toFixed(2);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function itemsHtmlRows(items) {
  return items.map(i => `
    <tr>
      <td style="padding:6px 0;">
        ${escapeHtml(i.title)} &times; ${i.qty}
        ${i.isPreorder ? `<br><span style="font-size:11px; color:#b45309; font-weight:bold;">PRE-ORDER${i.expectedDate ? ' — expected ' + escapeHtml(i.expectedDate) : ''}</span>` : ''}
      </td>
      <td style="padding:6px 0; text-align:right;">${formatMYR(i.price * i.qty)}</td>
    </tr>
  `).join('');
}

function hasPreorderItems(items) {
  return items.some(i => i.isPreorder);
}

function totalsHtmlRows(order) {
  return `
    <tr><td style="padding-top:10px; border-top:1px solid #e7e5e4;">Subtotal</td><td style="padding-top:10px; border-top:1px solid #e7e5e4; text-align:right;">${formatMYR(order.subtotal)}</td></tr>
    <tr><td>Shipping &amp; Packaging</td><td style="text-align:right;">${order.shippingFee === 0 ? 'Free' : formatMYR(order.shippingFee)}</td></tr>
    <tr><td style="font-weight:bold; padding-top:6px;">Total</td><td style="font-weight:bold; padding-top:6px; text-align:right;">${formatMYR(order.amount)}</td></tr>
  `;
}

function deliveryHtml(order) {
  if (order.deliveryMethod === 'shipping' && order.shippingAddress) {
    const a = order.shippingAddress;
    return `
      <p style="margin:16px 0 4px;"><strong>Delivery:</strong> Shipping</p>
      <p style="margin:0; color:#44403c;">
        ${escapeHtml(a.line1)}${a.line2 ? '<br>' + escapeHtml(a.line2) : ''}<br>
        ${escapeHtml(a.postcode)} ${escapeHtml(a.city)}, ${escapeHtml(a.state)}
      </p>
    `;
  }
  return `
    <p style="margin:16px 0 4px;"><strong>Delivery:</strong> Self-Pickup</p>
    <p style="margin:0; color:#44403c;">No 11, Jalan Sulaiman, Muar, Johor 84000 — we'll reach out by phone or email to arrange a time.</p>
  `;
}

async function sendOrderConfirmationEmail(order) {
  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">Thanks for your order, ${escapeHtml(order.payer.name)}!</h2>
      <p style="color:#57534e;">Order <strong>${order.orderNumber}</strong> is confirmed.</p>
      ${hasPreorderItems(order.items) ? `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px; margin:12px 0; font-size:13px; color:#92400e;">
          <strong>Heads up:</strong> this order includes one or more pre-order items (marked below). Those will ship separately once available — everything else goes out as usual.
        </div>
      ` : ''}
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      ${deliveryHtml(order)}
      <p style="color:#57534e; font-size:13px; margin-top:16px;">
        ${order.deliveryMethod === 'shipping'
          ? "We'll email you again with a tracking link once your order ships."
          : "We'll email you once your order is ready for pickup."}
      </p>
      <p style="color:#a8a29e; font-size:12px; margin-top:28px;">Ritma Records — Muar, Johor, Malaysia</p>
    </div>
  `;
  return sendEmail({ to: order.payer.email, subject: `Your Ritma Records order ${order.orderNumber}`, html });
}

async function sendAdminNotificationEmail(order) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) {
    console.warn('[Ritma] ADMIN_NOTIFICATION_EMAIL not set — skipping admin notification.');
    return { sent: false, reason: 'not_configured' };
  }
  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">New paid order: ${order.orderNumber}</h2>
      ${hasPreorderItems(order.items) ? `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px; margin:12px 0; font-size:13px; color:#92400e;">
          <strong>Contains pre-order item(s)</strong> — hold this order until stock arrives rather than fulfilling immediately.
        </div>
      ` : ''}
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      <p style="margin:16px 0 4px;"><strong>Customer</strong></p>
      <p style="margin:0; color:#44403c;">
        ${escapeHtml(order.payer.name)}<br>
        ${escapeHtml(order.payer.phone)}<br>
        ${escapeHtml(order.payer.email)}
      </p>
      ${deliveryHtml(order)}
      <p style="margin-top:24px;"><a href="https://ritmarecords.com/dashboard" style="color:#ea580c;">Open dashboard →</a></p>
    </div>
  `;
  return sendEmail({
    to: adminEmail,
    subject: `New order ${order.orderNumber} — ${formatMYR(order.amount)}`,
    html,
    replyTo: order.payer.email
  });
}

/* ==========================================================================
   Manual bank transfer invoice — sent immediately at checkout (NOT once
   paid, unlike the two emails above) since this IS the payment
   instruction. Interim measure while Bayarcash isn't set up yet. Order
   stays 'pending' in Supabase until the admin manually confirms the
   transfer landed and marks it paid from the dashboard, which then fires
   sendOrderConfirmationEmail/sendAdminNotificationEmail as normal.
   ========================================================================== */
async function sendInvoiceEmail(order) {
  const bankName = process.env.BANK_NAME || '';
  const bankAccountName = process.env.BANK_ACCOUNT_NAME || '';
  const bankAccountNumber = process.env.BANK_ACCOUNT_NUMBER || '';

  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">Invoice for your order, ${escapeHtml(order.payer.name)}</h2>
      <p style="color:#57534e;">Order / Invoice No. <strong>${order.orderNumber}</strong></p>
      <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:14px; margin:16px 0; font-size:13px; color:#7c2d12;">
        This order is <strong>not paid yet</strong>. Please complete a bank transfer for the total below, using
        <strong>${order.orderNumber}</strong> as the payment reference, so it can be matched to your order.
      </div>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      <div style="background:#f5f5f4; border-radius:8px; padding:14px; margin:16px 0; font-size:14px;">
        <p style="margin:0 0 8px; font-weight:bold;">Bank Transfer Details</p>
        <p style="margin:0;">Bank: ${escapeHtml(bankName)}</p>
        <p style="margin:0;">Account Name: ${escapeHtml(bankAccountName)}</p>
        <p style="margin:0;">Account Number: ${escapeHtml(bankAccountNumber)}</p>
        <p style="margin:8px 0 0; font-size:12px; color:#78716c;">Reference: ${order.orderNumber}</p>
      </div>
      ${deliveryHtml(order)}
      <p style="color:#57534e; font-size:13px; margin-top:16px;">
        Once we've confirmed your transfer, you'll receive a separate order confirmation email and your order will be prepared for
        ${order.deliveryMethod === 'shipping' ? 'shipping' : 'pickup'}.
      </p>
      <p style="color:#a8a29e; font-size:12px; margin-top:28px;">Ritma Records — Muar, Johor, Malaysia</p>
    </div>
  `;
  return sendEmail({ to: order.payer.email, subject: `Invoice ${order.orderNumber} — Ritma Records`, html });
}

async function sendAdminPendingBankTransferEmail(order) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) {
    console.warn('[Ritma] ADMIN_NOTIFICATION_EMAIL not set — skipping pending-order admin notification.');
    return { sent: false, reason: 'not_configured' };
  }
  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">New order awaiting bank transfer: ${order.orderNumber}</h2>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px; margin:12px 0; font-size:13px; color:#1e40af;">
        <strong>Not paid yet.</strong> The buyer has been sent an invoice with your bank details. Check Maybank for a transfer referencing
        <strong>${order.orderNumber}</strong>, then mark it paid on the dashboard once confirmed.
      </div>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      <p style="margin:16px 0 4px;"><strong>Customer</strong></p>
      <p style="margin:0; color:#44403c;">
        ${escapeHtml(order.payer.name)}<br>
        ${escapeHtml(order.payer.phone)}<br>
        ${escapeHtml(order.payer.email)}
      </p>
      ${deliveryHtml(order)}
      <p style="margin-top:24px;"><a href="https://ritmarecords.com/dashboard" style="color:#ea580c;">Open dashboard to mark paid →</a></p>
    </div>
  `;
  return sendEmail({
    to: adminEmail,
    subject: `Awaiting payment: ${order.orderNumber} — ${formatMYR(order.amount)}`,
    html,
    replyTo: order.payer.email
  });
}

async function sendShippedEmail(order) {
  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">Your order is on the way, ${escapeHtml(order.payer.name)}!</h2>
      <p style="color:#57534e;">Order <strong>${order.orderNumber}</strong> has shipped.</p>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:14px; margin:16px 0; text-align:center;">
        <a href="${order.trackingLink}" style="display:inline-block; background:#ea580c; color:#fff; text-decoration:none; font-weight:bold; font-size:13px; padding:10px 20px; border-radius:8px;">
          Track Your Package
        </a>
      </div>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      ${deliveryHtml(order)}
      <p style="color:#a8a29e; font-size:12px; margin-top:28px;">Ritma Records — Muar, Johor, Malaysia</p>
    </div>
  `;
  return sendEmail({ to: order.payer.email, subject: `Your order ${order.orderNumber} has shipped`, html });
}

async function sendReadyForPickupEmail(order) {
  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">Ready for pickup, ${escapeHtml(order.payer.name)}!</h2>
      <p style="color:#57534e;">Order <strong>${order.orderNumber}</strong> is ready whenever you are.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      ${deliveryHtml(order)}
      <p style="color:#a8a29e; font-size:12px; margin-top:28px;">Ritma Records — Muar, Johor, Malaysia</p>
    </div>
  `;
  return sendEmail({ to: order.payer.email, subject: `Order ${order.orderNumber} is ready for pickup`, html });
}

module.exports = {
  sendOrderConfirmationEmail,
  sendAdminNotificationEmail,
  sendInvoiceEmail,
  sendAdminPendingBankTransferEmail,
  sendShippedEmail,
  sendReadyForPickupEmail
};
