/* ==========================================================================
   Ritma Records — catalog grid + format filters
   Used on index.html. Depends on app.js being loaded first (PRODUCTS,
   loadProducts, addToCart, formatMYR).
   ========================================================================== */

function renderProducts(items) {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-center text-stone-600 text-sm py-12">No items match this filter yet — check back soon.</p>`;
    return;
  }

  grid.innerHTML = items.map(p => `
    <div class="bg-white border border-stone-200 hover:border-orange-500 rounded-xl overflow-hidden transition group shadow-sm">
      <a href="product.html?id=${p.id}" class="block relative overflow-hidden">
        <img src="${p.img}" alt="${escapeHtml(p.title)}" class="w-full h-56 object-cover group-hover:scale-105 transition duration-300 ${p.stock === 0 ? 'grayscale opacity-60' : ''}">
        <span class="absolute top-2 left-2 text-[10px] bg-orange-600 text-white font-black px-2 py-0.5 rounded uppercase shadow-sm">${escapeHtml(p.format)}</span>
        ${p.stock === 0
          ? `<span class="absolute top-2 right-2 text-[10px] bg-stone-900 text-white font-black px-2 py-0.5 rounded uppercase">Sold Out</span>`
          : p.stock <= 3
            ? `<span class="absolute top-2 right-2 text-[10px] bg-black/80 text-orange-400 font-black px-2 py-0.5 rounded uppercase border border-orange-600/40">Low stock</span>`
            : ''}
      </a>
      <div class="p-4">
        <span class="text-[10px] bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded uppercase border border-orange-200 inline-block mb-2">${escapeHtml(p.condition)}</span>
        <a href="product.html?id=${p.id}" class="block">
          <p class="text-[11px] text-stone-500 font-bold uppercase tracking-wide mb-0.5">${escapeHtml(p.artist)}</p>
          <h3 class="text-sm font-bold text-stone-900 mb-2 line-clamp-1 hover:text-orange-600 transition">${escapeHtml(p.title)}</h3>
        </a>
        <div class="flex items-center justify-between mt-4">
          <span class="text-orange-600 font-extrabold text-base">${formatMYR(p.price)}</span>
          ${p.stock === 0
            ? `<button disabled class="bg-stone-200 text-stone-400 px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-not-allowed">Sold Out</button>`
            : `<button onclick="addToCart(${p.id})" class="bg-orange-600 hover:bg-orange-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition">+ Add</button>`}
        </div>
      </div>
    </div>
  `).join('');
}

function filterCatalog(category, element) {
  if (element) {
    const buttons = document.querySelectorAll('#format-tab-group .format-btn');
    buttons.forEach(btn => {
      btn.className = "format-btn bg-stone-200 hover:bg-orange-100 border border-stone-300 hover:border-orange-500 text-stone-700 hover:text-orange-600 px-5 py-2.5 rounded-full text-xs font-bold uppercase transition";
    });
    element.className = "format-btn bg-orange-600 text-white px-5 py-2.5 rounded-full text-xs font-bold uppercase transition shadow-md shadow-orange-600/20";
  }

  let filtered;
  if (category === 'all') filtered = PRODUCTS;
  else if (category === 'new') filtered = PRODUCTS.filter(p => p.condition.startsWith('New'));
  else if (category === 'preloved') filtered = PRODUCTS.filter(p => p.condition.includes('Preloved'));
  else filtered = PRODUCTS.filter(p => p.format === category);

  renderProducts(filtered);

  const catalogSection = document.getElementById('catalog');
  if (catalogSection && category !== 'all') {
    catalogSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadProducts();
  renderProducts(PRODUCTS);
});
