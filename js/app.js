/* ==========================================================================
   Ritma Records — shared app logic
   Loaded on every page. Handles: product data loading, cart (persisted in
   localStorage so it survives navigation between pages), cart drawer UI,
   mobile nav, and the checkout hand-off to the Bayarcash Netlify Function.
   ========================================================================== */

const CART_KEY = 'ritma_cart_v1';
let PRODUCTS = [];

/* ---------- Product data ---------- */

async function loadProducts() {
  if (PRODUCTS.length) return PRODUCTS;
  try {
    const res = await fetch('/.netlify/functions/get-products');
    if (!res.ok) throw new Error(`Failed to load products (${res.status})`);
    PRODUCTS = await res.json();
  } catch (err) {
    console.error('[Ritma] Could not load live products, falling back to static catalog:', err);
    // Fallback only matters when previewing raw HTML without `netlify dev` —
    // in production get-products.js should always answer.
    try {
      const res = await fetch('/data/products.json');
      PRODUCTS = res.ok ? await res.json() : [];
    } catch {
      PRODUCTS = [];
    }
  }
  return PRODUCTS;
}

function getProductById(id) {
  return PRODUCTS.find(p => p.id === Number(id));
}

function formatMYR(amount) {
  return `RM ${Number(amount).toFixed(2)}`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Cart (localStorage-backed) ----------
   Shape: [{ id, qty }]  — product details are re-hydrated from PRODUCTS
   at render time, so we never store stale price/title copies. */

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('[Ritma] Cart data corrupted, resetting.', err);
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartUI();
}

function addToCart(id, qty = 1) {
  const product = getProductById(id);
  const maxQty = product && typeof product.stock === 'number' ? product.stock : Infinity;

  const cart = readCart();
  const existing = cart.find(item => item.id === Number(id));
  const currentQtyInCart = existing ? existing.qty : 0;
  const nextQty = Math.min(currentQtyInCart + qty, maxQty);

  if (nextQty <= currentQtyInCart) {
    alert(product ? `Sorry, only ${maxQty} left in stock.` : 'That item is no longer available.');
    return;
  }

  if (existing) {
    existing.qty = nextQty;
  } else {
    cart.push({ id: Number(id), qty: nextQty });
  }
  writeCart(cart);
  flashCartBadge();
}

function setQty(id, qty) {
  let cart = readCart();
  const product = getProductById(id);
  const maxQty = product && typeof product.stock === 'number' ? product.stock : Infinity;
  qty = Math.max(0, Math.min(Math.floor(qty) || 0, maxQty));
  if (qty === 0) {
    cart = cart.filter(item => item.id !== Number(id));
  } else {
    const existing = cart.find(item => item.id === Number(id));
    if (existing) existing.qty = qty;
  }
  writeCart(cart);
}

function removeFromCart(id) {
  const cart = readCart().filter(item => item.id !== Number(id));
  writeCart(cart);
}

function cartLineItems() {
  return readCart()
    .map(entry => {
      const product = getProductById(entry.id);
      return product ? { ...product, qty: entry.qty } : null;
    })
    .filter(Boolean);
}

function cartCount() {
  return readCart().reduce((sum, item) => sum + item.qty, 0);
}

function cartSubtotal() {
  return cartLineItems().reduce((sum, item) => sum + item.price * item.qty, 0);
}

function flashCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  badge.classList.add('scale-125');
  setTimeout(() => badge.classList.remove('scale-125'), 150);
}

/* ---------- Cart UI (drawer present on every page) ---------- */

function updateCartUI() {
  const count = cartCount();
  const badge = document.getElementById('cart-badge');
  if (badge) {
    badge.innerText = count;
    badge.classList.toggle('hidden', count === 0);
  }

  // Pages with their own cart/order summary (checkout.html) hook in here so
  // it stays in sync if the cart changes from the drawer on that same page.
  if (typeof renderCheckoutSummary === 'function') renderCheckoutSummary();

  const titleCount = document.getElementById('cart-count-title');
  if (titleCount) titleCount.innerText = count;

  const subtotalEl = document.getElementById('cart-subtotal');
  if (subtotalEl) subtotalEl.innerText = formatMYR(cartSubtotal());

  const cartContainer = document.getElementById('cart-items');
  if (!cartContainer) return;

  const items = cartLineItems();
  if (items.length === 0) {
    cartContainer.innerHTML = `<p class="text-stone-400 text-xs text-center py-8">Your crate is empty.</p>`;
    return;
  }

  cartContainer.innerHTML = items.map(item => `
    <div class="flex items-center gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200">
      <img src="${item.img}" alt="${escapeHtml(item.title)}" class="w-12 h-12 rounded object-cover flex-shrink-0">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-bold text-stone-900 truncate">${escapeHtml(item.title)}</p>
        <p class="text-[10px] text-orange-600 font-bold uppercase mt-1">${escapeHtml(item.format)} • ${formatMYR(item.price)}</p>
        <div class="flex items-center gap-2 mt-2">
          <button onclick="setQty(${item.id}, ${item.qty - 1})" class="w-6 h-6 flex items-center justify-center bg-stone-200 hover:bg-stone-300 text-stone-900 rounded text-xs">−</button>
          <span class="text-xs text-stone-900 font-bold w-5 text-center">${item.qty}</span>
          <button onclick="setQty(${item.id}, ${item.qty + 1})" class="w-6 h-6 flex items-center justify-center bg-stone-200 hover:bg-stone-300 text-stone-900 rounded text-xs">+</button>
        </div>
      </div>
      <button onclick="removeFromCart(${item.id})" class="text-stone-400 hover:text-red-500 text-xs p-1 flex-shrink-0"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

function toggleCart() {
  const drawer = document.getElementById('cart-drawer');
  if (drawer) drawer.classList.toggle('hidden');
}

/* ---------- Mobile nav ---------- */

function toggleMobileNav() {
  const menu = document.getElementById('mobile-nav');
  if (menu) menu.classList.toggle('hidden');
}

/* ---------- Header active tab ----------
   Nav links are plain <a href="page.html"> now (multi-page site), so the
   active tab is derived from the current URL rather than an onclick
   handler — this works correctly however the user arrived at the page. */

function highlightActiveNav() {
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.header-nav-tab').forEach(tab => {
    const tabPage = (tab.getAttribute('href') || '').split('?')[0].split('#')[0] || 'index.html';
    const isActive = tabPage === currentPage || (tabPage === 'index.html' && currentPage === '');
    tab.classList.toggle('text-white', isActive);
    tab.classList.toggle('font-extrabold', isActive);
    tab.classList.toggle('border-b-2', isActive);
    tab.classList.toggle('border-white', isActive);
    tab.classList.toggle('text-orange-100', !isActive);
    tab.classList.toggle('font-bold', !isActive);
  });
}

/* ---------- Checkout ----------
   The cart drawer's button no longer pays directly — it hands off to
   checkout.html, which collects name/phone/email/delivery method/address
   before calling the Bayarcash Netlify Function. Until real Bayarcash
   merchant credentials are added as environment variables in Netlify, that
   function responds with a "not configured yet" message instead of a live
   payment URL — see netlify/functions/create-bayarcash-payment.js. */

function goToCheckout() {
  if (cartLineItems().length === 0) {
    alert('Your crate is empty — add something before checking out.');
    return;
  }
  location.href = 'checkout.html';
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  highlightActiveNav();
});
