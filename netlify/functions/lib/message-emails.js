/* ==========================================================================
   Ritma Records — new message notification email
   ==========================================================================
   Fires once per submission, straight after it's saved (see
   submit-message.js). Sent via Resend — see lib/email.js for the same
   "unverified domain can only deliver to the Resend account's own signup
   address" limitation already flagged for order receipts. Sending to
   hello@ritmarecords.com specifically will only actually arrive once that
   domain is verified in Resend; until then this call will silently fail
   (logged, not thrown — never blocks the submission itself from saving).
   ========================================================================== */

const { sendEmail } = require('./email');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FORMAT_LABELS = { lp: 'LP / Vinyl', cd: 'CD', cassette: 'Cassette', merch: 'Band Merch', other: 'Other' };

async function sendMessageNotificationEmail(msg) {
  const notifyTo = process.env.MESSAGE_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!notifyTo) {
    console.warn('[Ritma] No notification email configured — skipping message notification.');
    return { sent: false, reason: 'not_configured' };
  }

  const isRequest = msg.type === 'request';
  const subject = isRequest
    ? `Item request from ${msg.name}: ${msg.item}`
    : `Contact form message from ${msg.name}`;

  const bodyHtml = isRequest
    ? `
      <p><strong>Format:</strong> ${escapeHtml(FORMAT_LABELS[msg.format] || msg.format || '—')}</p>
      <p><strong>Item:</strong> ${escapeHtml(msg.item)}</p>
      ${msg.details ? `<p><strong>Details:</strong><br>${escapeHtml(msg.details).replace(/\n/g, '<br>')}</p>` : ''}
    `
    : `
      ${msg.orderNumber ? `<p><strong>Order #:</strong> ${escapeHtml(msg.orderNumber)}</p>` : ''}
      <p><strong>Message:</strong><br>${escapeHtml(msg.message).replace(/\n/g, '<br>')}</p>
    `;

  const html = `
    <div style="font-family: Arial, sans-serif; color:#1c1917; max-width:480px; margin:0 auto;">
      <h2 style="color:#ea580c; margin-bottom:4px;">${isRequest ? 'New item request' : 'New contact message'}</h2>
      <p style="margin:0 0 12px; color:#44403c;">
        ${escapeHtml(msg.name)}<br>
        ${escapeHtml(msg.email)}
      </p>
      ${bodyHtml}
      <p style="margin-top:24px;"><a href="https://ritmarecords.com/dashboard" style="color:#ea580c;">View in dashboard →</a></p>
    </div>
  `;

  return sendEmail({ to: notifyTo, subject, html, replyTo: msg.email });
}

module.exports = { sendMessageNotificationEmail };
