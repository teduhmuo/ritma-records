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
      <td style="padding:6px 0;">${escapeHtml(i.title)} &times; ${i.qty}</td>
      <td style="padding:6px 0; text-align:right;">${formatMYR(i.price * i.qty)}</td>
    </tr>
  `).join('');
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
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        ${itemsHtmlRows(order.items)}
        ${totalsHtmlRows(order)}
      </table>
      ${deliveryHtml(order)}
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

module.exports = { sendOrderConfirmationEmail, sendAdminNotificationEmail };
