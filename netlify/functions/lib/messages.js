/* ==========================================================================
   Ritma Records — Request Item & Contact Us message storage (Supabase)
   ==========================================================================
   Both request.html and contact.html now submit here instead of relying on
   Netlify Forms — that only stored submissions inside Netlify's own system,
   invisible to the custom dashboard. This keeps everything in one place,
   same pattern as products/orders.
   ========================================================================== */

const { getSupabaseClient } = require('./supabase');

function rowToMessage(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    email: row.email,
    format: row.format,
    item: row.item,
    details: row.details,
    orderNumber: row.order_number,
    message: row.message,
    status: row.status,
    createdAt: row.created_at
  };
}

async function saveMessage(data) {
  const supabase = getSupabaseClient();
  const { data: row, error } = await supabase
    .from('messages')
    .insert({
      type: data.type,
      name: data.name,
      email: data.email,
      format: data.format || null,
      item: data.item || null,
      details: data.details || null,
      order_number: data.orderNumber || null,
      message: data.message || null,
      status: 'new'
    })
    .select()
    .single();
  if (error) throw error;
  return rowToMessage(row);
}

async function listMessages() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('messages').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMessage);
}

async function markMessageStatus(id, status) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToMessage(data) : null;
}

module.exports = { saveMessage, listMessages, markMessageStatus };
