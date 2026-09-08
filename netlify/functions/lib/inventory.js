/* ==========================================================================
   Ritma Records — stock, orders, and dashboard aggregation (Supabase)
   ==========================================================================
   Replaces the old Netlify Blobs version (ritma-stock + ritma-orders
   stores). Stock now lives directly on each product's `stock` column
   (products table, see lib/catalog.js) — no more separate "seed vs live"
   split the Blobs version needed. Orders live in the `orders` table.
   ========================================================================== */

const { getSupabaseClient } = require('./supabase');
const { getAllProducts } = require('./catalog');

/* ---------- Stock ---------- */

/**
 * Checks a cart against live stock.
 * Returns { ok: true } or { ok: false, problems: [{ id, title, requested, available }] }
 */
async function checkStockAvailable(items) {
  const supabase = getSupabaseClient();
  const ids = items.map(i => i.id);
  const { data, error } = await supabase.from('products').select('id, title, stock').in('id', ids);
  if (error) throw error;

  const byId = Object.fromEntries(data.map(p => [p.id, p]));
  const problems = [];
  for (const item of items) {
    const product = byId[item.id];
    const available = product ? product.stock : 0;
    if (item.qty > available) {
      problems.push({
        id: item.id,
        title: item.title || (product && product.title) || 'Unknown item',
        requested: item.qty,
        available
      });
    }
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

/**
 * Decrements stock for each item in a paid order via the decrement_stock
 * Postgres function (see the schema SQL) — a single atomic UPDATE per
 * item, so unlike the old Blobs version there's no read-then-write race
 * window between simultaneous orders for the same product.
 */
async function decrementStock(items) {
  const supabase = getSupabaseClient();
  for (const item of items) {
    const { error } = await supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.qty });
    if (error) throw error;
  }
}

/** Sets live stock to an exact value — used by the admin dashboard when creating or restocking a product. */
async function setStock(id, value) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('products')
    .update({ stock: Math.max(0, Number(value) || 0), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/* ---------- Orders ---------- */

function rowToOrder(row) {
  return {
    orderNumber: row.order_number,
    items: row.items,
    subtotal: Number(row.subtotal),
    shippingFee: Number(row.shipping_fee),
    amount: Number(row.amount),
    deliveryMethod: row.delivery_method,
    shippingAddress: row.shipping_address,
    payer: row.payer,
    status: row.status,
    paymentMethod: row.payment_method || 'bayarcash',
    trackingLink: row.tracking_link || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function saveOrder(orderNumber, order) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('orders').insert({
    order_number: orderNumber,
    items: order.items,
    subtotal: order.subtotal,
    shipping_fee: order.shippingFee,
    amount: order.amount,
    delivery_method: order.deliveryMethod,
    shipping_address: order.shippingAddress,
    payer: order.payer,
    status: order.status,
    payment_method: order.paymentMethod || 'bayarcash',
    created_at: order.createdAt
  });
  if (error) throw error;
}

async function getOrder(orderNumber) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('orders').select('*').eq('order_number', orderNumber).maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}

/**
 * Updates an order's status, and optionally other fields at the same time
 * (currently just trackingLink, used when marking an order shipped) — one
 * write instead of two separate updates.
 */
async function markOrderStatus(orderNumber, status, extra = {}) {
  const supabase = getSupabaseClient();
  const patch = { status, updated_at: new Date().toISOString() };
  if (extra.trackingLink !== undefined) patch.tracking_link = extra.trackingLink;

  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('order_number', orderNumber)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}

async function listAllOrders() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToOrder);
}

/* ---------- Dashboard ---------- */

// Fulfilment states that happen AFTER payment — all still count as "paid"
// for revenue/stock purposes. status alone only ever moves forward:
// pending -> paid -> (shipped | ready_for_pickup).
const PAID_LIKE_STATUSES = ['paid', 'shipped', 'ready_for_pickup'];

async function getDashboardData() {
  const orders = await listAllOrders();
  const paidOrders = orders.filter(o => PAID_LIKE_STATUSES.includes(o.status));
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const failedOrders = orders.filter(o => o.status === 'failed');

  const skuStats = {};
  for (const order of paidOrders) {
    for (const item of order.items) {
      if (!skuStats[item.id]) skuStats[item.id] = { unitsSold: 0, revenue: 0 };
      skuStats[item.id].unitsSold += item.qty;
      skuStats[item.id].revenue += item.qty * Number(item.price);
    }
  }

  const products = await getAllProducts();
  const productsWithStats = products.map(p => {
    const stats = skuStats[p.id];
    return {
      id: p.id,
      sku: p.sku,
      title: p.title,
      artist: p.artist,
      price: p.price,
      stock: p.stock,
      unitsSold: stats ? stats.unitsSold : 0,
      revenue: stats ? Number(stats.revenue.toFixed(2)) : 0
    };
  });

  const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.amount), 0);

  const recentOrders = orders.slice(0, 25).map(o => ({
    orderNumber: o.orderNumber,
    status: o.status,
    paymentMethod: o.paymentMethod,
    trackingLink: o.trackingLink,
    amount: o.amount,
    subtotal: o.subtotal,
    shippingFee: o.shippingFee,
    itemCount: o.items.reduce((s, i) => s + i.qty, 0),
    items: o.items,
    payer: o.payer,
    deliveryMethod: o.deliveryMethod,
    shippingAddress: o.shippingAddress,
    createdAt: o.createdAt
  }));

  return {
    summary: {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      paidOrders: paidOrders.length,
      pendingOrders: pendingOrders.length,
      failedOrders: failedOrders.length,
      lowStockCount: productsWithStats.filter(p => p.stock > 0 && p.stock <= 3).length,
      outOfStockCount: productsWithStats.filter(p => p.stock === 0).length
    },
    products: productsWithStats,
    recentOrders
  };
}

module.exports = {
  checkStockAvailable,
  decrementStock,
  setStock,
  saveOrder,
  getOrder,
  markOrderStatus,
  listAllOrders,
  getDashboardData
};
