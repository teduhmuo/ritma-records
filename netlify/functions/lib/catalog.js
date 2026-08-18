/* ==========================================================================
   Ritma Records — product catalog & photo storage (Netlify Blobs)
   ==========================================================================
   Two blob stores:
     ritma-products   key = product id (string) -> full product object
                       (title, artist, format, condition, price, etc.)
     ritma-images      key = product id (string) -> raw photo bytes,
                       with a contentType in the blob's metadata

   data/products.json is now only a one-time SEED: the first time
   getAllProducts() runs against an empty store, it copies that file's 8
   starter records in and sets a marker so it never reseeds again — even
   if every product later gets deleted. After that, ritma-products is the
   real source of truth, and products.json is just historical.
   ========================================================================== */

const { getStore } = require('@netlify/blobs');
const seedProducts = require('../../../data/products.json');

const PRODUCT_STORE = 'ritma-products';
const IMAGE_STORE = 'ritma-images';
const SEED_MARKER_KEY = '__seeded__';

function productStore() {
  return getStore(PRODUCT_STORE);
}

function imageStore() {
  return getStore(IMAGE_STORE);
}

/** Copies the products.json seed in on the very first call, once, ever. */
async function ensureSeeded() {
  const store = productStore();
  const seeded = await store.get(SEED_MARKER_KEY, { type: 'json' });
  if (seeded) return;
  for (const p of seedProducts) {
    await store.setJSON(String(p.id), p);
  }
  await store.setJSON(SEED_MARKER_KEY, true);
}

async function getAllProducts() {
  await ensureSeeded();
  const store = productStore();
  const { blobs } = await store.list();
  const ids = blobs.map(b => b.key).filter(k => k !== SEED_MARKER_KEY);
  const products = await Promise.all(ids.map(id => store.get(id, { type: 'json' })));
  return products.filter(Boolean).sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Looks up one product. Also seed-aware — matters the first time this
 * store is ever touched by a checkout (create-bayarcash-payment.js calls
 * this per cart item) rather than by someone browsing the catalog first.
 */
async function getProduct(id) {
  await ensureSeeded();
  return productStore().get(String(id), { type: 'json' });
}

async function saveProduct(product) {
  await productStore().setJSON(String(product.id), product);
}

async function deleteProduct(id) {
  await productStore().delete(String(id));
  await imageStore().delete(String(id));
}

/** Not concurrency-safe (max+1) — fine for a single-admin tool, same tradeoff as elsewhere in this codebase. */
async function nextProductId() {
  const products = await getAllProducts();
  const maxId = products.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
  return maxId + 1;
}

async function saveImage(id, base64Data, contentType) {
  const buffer = Buffer.from(base64Data, 'base64');
  await imageStore().set(String(id), buffer, { metadata: { contentType: contentType || 'image/jpeg' } });
}

async function getImage(id) {
  return imageStore().getWithMetadata(String(id), { type: 'arrayBuffer' });
}

module.exports = {
  getAllProducts,
  getProduct,
  saveProduct,
  deleteProduct,
  nextProductId,
  saveImage,
  getImage
};
