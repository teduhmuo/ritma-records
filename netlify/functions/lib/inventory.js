/* ==========================================================================
   Ritma Records — inventory & order helpers (shared by Netlify Functions)
   ==========================================================================
   Live stock counts live in Netlify Blobs, NOT in products.json. The JSON
   file stays the hand-edited "master catalog" (title, price, images, and a
   starting stock count) exactly as before — this module only tracks how
   that starting count has been *decremented by real sales* since then.

   Two blob stores:
     ritma-stock   key = product id (string) -> current stock (number)
                   Lazily seeded from products.json's `stock` field the
                   first time a product is looked up, so there's no manual
                   migration step.
     ritma-orders  key = order number -> { items, amount, status, ... }
                   Written when a Bayarcash payment intent is created, and
                   updated by the webhook once the payment result is known.
                   This exists because Bayarcash's callback only carries the
                   order number + status — without this record there'd be no
                   way to know *which products* to decrement stock for.

   CONCURRENCY NOTE: Netlify Blobs has no compare-and-swap — writes are
   last-write-wins (see Netlify's Blobs docs). Two orders for the same
   product landing in the same instant could in theory both read the same
   "before" count. For Ritma's order volume this is a non-issue; if that
   ever changes, this is the place to add a locking/queue mechanism.
   ========================================================================== */

const { getStore } = require('@netlify/blobs');
const productsData = require('../../../data/products.json');

const STOCK_STORE = 'ritma-stock';
const ORDER_STORE = 'ritma-orders';

function stockStore() {
  return getStore(STOCK_STORE);
}

function orderStore() {
  return getStore(ORDER_STORE);
}

function baseStock(id) {
  const product = productsData.find(p => p.id === Number(id));
  return product ? Number(product.stock) || 0 : 0;
}

/* ---------- Stock ---------- */

/** Live stock for a single product id, seeding from products.json on first read. */
async function getLiveStock(id) {
  const store = stockStore();
  const key = String(id);
  const existing = await store.get(key, { type: 'json' });
  if (existing !== null && existing !== undefined) return existing;
  const seeded = baseStock(id);
  await store.setJSON(key, seeded);
  return seeded;
}

/** { [id]: liveStock } for a list of ids, or every product in the catalog if omitted. */
async function getLiveStockMap(ids) {
  const targetIds = ids && ids.length ? ids : productsData.map(p => p.id);
  const store = stockStore();
  const entries = await Promise.all(targetIds.map(async id => {
    let value = await store.get(String(id), { type: 'json' });
    if (value === null || value === undefined) {
      value = baseStock(id);
      await store.setJSON(String(id), value);
    }
    return [id, value];
  }));
  return Object.fromEntries(entries);
}

/**
 * Checks a cart against live stock.
 * Returns { ok: true } or { ok: false, problems: [{ id, title, requested, available }] }
 */
async function checkStockAvailable(items) {
  const store = stockStore();
  const problems = [];
  for (const item of items) {
    let available = await store.get(String(item.id), { type: 'json' });
    if (available === null || available === undefined) available = baseStock(item.id);
    if (item.qty > available) {
      problems.push({ id: item.id, title: item.title, requested: item.qty, available });
    }
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Decrements stock for each item in a paid order. Floors at 0 (never goes negative). */
async function decrementStock(items) {
  const store = stockStore();
  for (const item of items) {
    let current = await store.get(String(item.id), { type: 'json' });
    if (current === null || current === undefined) current = baseStock(item.id);
    const next = Math.max(0, current - item.qty);
    await store.setJSON(String(item.id), next);
  }
}

/**
 * Sets live stock to an exact value — used by the admin dashboard when
 * creating a product or restocking one. Different from decrementStock,
 * which is relative and driven by paid orders, not manual entry.
 */
async function setStock(id, value) {
  await stockStore().setJSON(String(id), Math.max(0, Number(value) || 0));
}

/* ---------- Orders ---------- */

async function saveOrder(orderNumber, order) {
  await orderStore().setJSON(orderNumber, order);
}

async function getOrder(orderNumber) {
  return orderStore().get(orderNumber, { type: 'json' });
}

async function markOrderStatus(orderNumber, status) {
  const order = await getOrder(orderNumber);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  await saveOrder(orderNumber, order);
  return order;
}

/** Every saved order, newest-first-agnostic (caller sorts). Fine at Ritma's order volume. */
async function listAllOrders() {
  const store = orderStore();
  const { blobs } = await store.list();
  const orders = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return orders.filter(Boolean);
}

/* ---------- Dashboard ---------- */

/**
 * Aggregates orders + live stock into what the SKU/revenue/stock dashboard
 * needs: per-product units-sold and revenue (paid orders only — pending and
 * failed orders never decremented stock, so they shouldn't count as sales
 * either), plus a recent-orders feed for context.
 */
async function getDashboardData() {
  const orders = await listAllOrders();
  const paidOrders = orders.filter(o => o.status === 'paid');
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const failedOrders = orders.filter(o => o.status === 'failed');

  const skuStats = {}; // product id -> { unitsSold, revenue }
  for (const order of paidOrders) {
    for (const item of order.items) {
      if (!skuStats[item.id]) skuStats[item.id] = { unitsSold: 0, revenue: 0 };
      skuStats[item.id].unitsSold += item.qty;
      skuStats[item.id].revenue += item.qty * Number(item.price);
    }
  }

  const stockMap = await getLiveStockMap();

  const products = productsData.map(p => {
    const stats = skuStats[p.id];
    return {
      id: p.id,
      sku: p.sku,
      title: p.title,
      artist: p.artist,
      price: p.price,
      stock: stockMap[p.id] !== undefined ? stockMap[p.id] : baseStock(p.id),
      unitsSold: stats ? stats.unitsSold : 0,
      revenue: stats ? Number(stats.revenue.toFixed(2)) : 0
    };
  });

  const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.amount), 0);

  const recentOrders = orders
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 25)
    .map(o => ({
      orderNumber: o.orderNumber,
      status: o.status,
      amount: o.amount,
      subtotal: o.subtotal,
      shippingFee: o.shippingFee,
      itemCount: o.items.reduce((s, i) => s + i.qty, 0),
      items: o.items,
      payer: o.payer || null,
      deliveryMethod: o.deliveryMethod || null,
      shippingAddress: o.shippingAddress || null,
      createdAt: o.createdAt
    }));

  return {
    summary: {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      paidOrders: paidOrders.length,
      pendingOrders: pendingOrders.length,
      failedOrders: failedOrders.length,
      lowStockCount: products.filter(p => p.stock > 0 && p.stock <= 3).length,
      outOfStockCount: products.filter(p => p.stock === 0).length
    },
    products,
    recentOrders
  };
}

module.exports = {
  getLiveStock,
  getLiveStockMap,
  checkStockAvailable,
  decrementStock,
  setStock,
  saveOrder,
  getOrder,
  markOrderStatus,
  listAllOrders,
  getDashboardData
};
