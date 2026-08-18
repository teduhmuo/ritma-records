/* ==========================================================================
   Ritma Records — Supabase client
   ==========================================================================
   One shared client for every function that needs the database. Uses the
   SECRET key (SUPABASE_SECRET_KEY) — this bypasses Row Level Security
   entirely, which is correct here: the browser never talks to Supabase
   directly, only through these Netlify Functions, same trust model the
   site used with Blobs.
   ========================================================================== */

const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Supabase is not configured — set SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify environment variables.');
  }

  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

module.exports = { getSupabaseClient };
