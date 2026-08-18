/* ==========================================================================
   Ritma Records — add/edit a product (Netlify Function)
   ==========================================================================
   Passcode protected (lib/auth.js). Creates a new product or overwrites an
   existing one via Supabase, optionally uploads a photo to Supabase
   Storage, and sets stock to exactly what the form says — this doubles as
   the restock mechanism.

   Photo handling: new products require a photo (nothing to fall back to
   without inventing a placeholder). Editing without choosing a new photo
   keeps whatever image the product already had. A new upload gets a
   fresh public URL automatically (the file path includes a timestamp),
   so there's no separate cache-busting step needed like the old
   Blobs-served version required.
   ========================================================================== */

const { checkPasscode, passcodeConfigured } = require('./lib/auth');
const { getProduct, saveProduct, saveImage } = require('./lib/catalog');

const VALID_FORMATS = ['lp', 'cd', 'cassette', 'merch'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // ~4MB raw — stays under Netlify's ~4.5MB base64 request limit

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!passcodeConfigured()) {
    return { statusCode: 200, body: JSON.stringify({ status: 'not_configured' }) };
  }
  if (!checkPasscode(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect passcode.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      id, title, artist, format, condition, genre, year,
      price, stock, sku, description, imageBase64, imageContentType
    } = body;

    if (!title || !artist || !format || !VALID_FORMATS.includes(format)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid required fields (title, artist, format).' }) };
    }
    if (price === undefined || price === null || isNaN(Number(price))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Price must be a number.' }) };
    }

    const isNew = !id;
    let existing = null;
    if (!isNew) {
      existing = await getProduct(id);
      if (!existing) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Product not found.' }) };
      }
    }

    if (!imageBase64 && isNew) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please add a photo for new products.' }) };
    }
    if (imageBase64) {
      const approxBytes = imageBase64.length * 0.75;
      if (approxBytes > MAX_IMAGE_BYTES) {
        return { statusCode: 413, body: JSON.stringify({ error: 'Photo is too large (max ~4MB) — please use a smaller image.' }) };
      }
    }

    const product = {
      id: isNew ? undefined : Number(id),
      title: String(title).trim(),
      artist: String(artist).trim(),
      format,
      condition: condition || 'New',
      price: Number(price),
      stock: Math.max(0, Number(stock) || 0),
      genre: genre ? String(genre).trim() : '',
      year: year ? Number(year) : null,
      sku: sku ? String(sku).trim() : null,
      description: description ? String(description).trim() : '',
      img: existing ? existing.img : undefined,
      imagePath: existing ? existing.imagePath : undefined
    };

    // Save first to get a real id for new products (needed to name the
    // photo file), then attach the photo, then save again if one was
    // uploaded — cheap enough at this scale and keeps the id/photo path
    // logic simple.
    let saved = await saveProduct(product);

    if (imageBase64) {
      const { url, path } = await saveImage(saved.id, imageBase64, imageContentType);
      saved = await saveProduct({ ...saved, img: url, imagePath: path });
    }

    if (!saved.sku) {
      saved = await saveProduct({ ...saved, sku: `RR-${format.toUpperCase()}-${String(saved.id).padStart(4, '0')}` });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', product: saved })
    };
  } catch (err) {
    console.error('[Ritma] admin-save-product error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save product.' }) };
  }
};
