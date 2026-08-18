# Ritma Records

Malaysian webstore for original LPs, rare Japanese CD pressings, vintage
cassettes, and official band merch. Static site + a couple of Netlify
Functions for checkout.

## Site structure

```
index.html                 Homepage + product catalog with format filters
product.html                Product detail page (?id=<product id>)
artist.html                 Artist directory, built from products.json
request.html                "Request an item" form (Netlify Forms)
contact.html                Contact form (Netlify Forms)
account.html                Order-status placeholder (no login system yet)
order-confirmation.html     Landing page after a successful Bayarcash payment
404.html                    Custom not-found page

data/products.json          Historical only — Supabase is now the catalog; kept as an
                             emergency fallback in js/app.js if get-products.js ever fails
js/app.js                   Shared cart, product loading, checkout logic
js/catalog.js                Catalog grid rendering + format filters (homepage only)

netlify/functions/create-bayarcash-payment.js   Checks stock, starts a Bayarcash checkout, saves the order
netlify/functions/bayarcash-webhook.js          Receives payment status updates, decrements stock on paid
netlify/functions/get-products.js               Public endpoint the frontend calls for the live catalog
netlify/functions/lib/supabase.js               Shared Supabase client (uses the secret key — server only)
netlify/functions/lib/catalog.js                Product + photo storage (Supabase table + Storage bucket)
netlify/functions/lib/inventory.js              Stock + order storage (Supabase tables)
netlify.toml                 Netlify build config
```

## Live stock & inventory

Stock lives directly on each product's `stock` column in Supabase — no
separate "seed vs live" layer needed, unlike an earlier version of this
site that used Netlify Blobs (a plain key-value store with no querying).

How it flows:

1. `netlify/functions/get-products.js` is the public endpoint `js/app.js`
   calls on every page load — it returns the full catalog straight from
   Supabase, stock included. The catalog grid, product page, and cart
   quantity steppers all reflect real availability (sold-out items show a
   disabled "Sold Out" state, and you can't add more to your crate than
   what's left).
2. When checkout starts, `create-bayarcash-payment.js` re-checks the cart
   against live stock and rejects (HTTP 409, with a clear message) if
   anything changed since the page loaded — before Bayarcash is ever
   contacted.
3. If Bayarcash accepts the payment intent, the order (items, computed
   total, customer + delivery details) is saved to Supabase's `orders`
   table. **Stock is not decremented yet at this point** — only once
   payment is confirmed.
4. `bayarcash-webhook.js` receives the payment result. On a paid status, it
   looks up the saved order and decrements stock via the `decrement_stock`
   Postgres function (see the schema SQL) — guarded so a duplicate webhook
   call (payment gateways commonly retry) won't double-decrement.

**Restocking an item:** open `/dashboard` → Products tab → Edit → change
the Stock number → Save. That sets stock directly — see "Managing
products" below.

**Concurrency note:** `decrement_stock` runs as a single atomic Postgres
`UPDATE`, so two simultaneous orders for the same last unit can't both
succeed the way they theoretically could with the old Blobs-based version.
One real improvement that came from this migration, not just a side effect.

## Managing products

Products are managed from **`/dashboard` → Products tab** — add a photo,
type, artist, title, condition, genre, year, price, stock, and description,
and it appears on the storefront right away. No redeploy needed.

Editing an existing product's stock number also **restocks it live** — the
form's stock field directly sets what customers see as available.

Under the hood: products live in Supabase's `products` table
(`netlify/functions/lib/catalog.js`), and photos live in the `ritma-records`
Storage bucket (public — that's what lets an uploaded photo's URL work
directly in `<img>` tags with no separate serving function needed).
`data/products.json` is no longer read by the catalog at all — the store
starts genuinely empty until products are added through the dashboard.

**Dashboard access:** set a `DASHBOARD_PASSCODE` environment variable in
Netlify (Project configuration → Environment variables) — without it, the
dashboard's login and every admin function refuse to work (fails closed,
not open). This is a single shared passcode, not per-user accounts; fine for
one admin, not meant to survive a targeted attack. See "Known gaps" below.

## Setting up Supabase

1. Create a Supabase project (separate from any other project — this one's
   dedicated to Ritma).
2. Run the schema SQL (ask for the latest version if it's not in this repo)
   in the SQL Editor — creates the `products` and `orders` tables plus the
   `decrement_stock` function.
3. Storage → New bucket → name it `ritma-records` → make it **Public**
   (photos need to load for anyone browsing, no login).
4. Settings → API Keys → copy the **secret** key (not the publishable one —
   the secret key bypasses Row Level Security, which is required since
   these Functions do all the reading/writing, not the browser directly).
5. In Netlify: Project configuration → Environment variables, add:
   - `SUPABASE_URL` (e.g. `https://xxxxx.supabase.co`)
   - `SUPABASE_SECRET_KEY` — mark this **Contains secret values**

## Deploying to Netlify

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In Netlify: **Add new site → Import an existing project**, connect the repo.
3. Build settings: no build command needed, publish directory `.` (already
   set in `netlify.toml`). Netlify will detect `netlify/functions`
   automatically.
4. Deploy. Your site will be live at `https://<your-site-name>.netlify.app`
   (or a custom domain you attach in Netlify's Domain settings).
5. Set the `DASHBOARD_PASSCODE` environment variable (see above) before
   relying on `/dashboard` for anything.

## Checkout, shipping & order emails

`checkout.html` is a real step now — the cart drawer's button no longer
pays directly, it hands off there first. It collects name, phone, email,
and a pickup-or-shipping choice (with a full address form if shipping),
then calls `create-bayarcash-payment.js`.

**Pricing is always recomputed server-side.** The function looks up each
cart item's real price from the live catalog and adds a flat RM15
shipping fee if shipping was chosen — it never trusts a total sent by the
browser, so editing prices in devtools before hitting "pay" does nothing.

**Two emails fire once an order is confirmed PAID** (`bayarcash-webhook.js`,
via `lib/order-emails.js` and `lib/email.js`) — never at checkout, since the
customer hasn't paid yet at that point and may abandon:
- A receipt to the customer
- A notification to you, with a "reply-to" set to the customer's email so
  you can just hit reply

**Setting up email (Resend):**
1. Sign up at https://resend.com and grab an API key.
2. In Netlify: **Project configuration → Environment variables**, add:
   - `RESEND_API_KEY`
   - `ADMIN_NOTIFICATION_EMAIL` — where your new-order alerts go
3. That's enough for the **admin notification** to work immediately.
4. **Customer receipts need one more step** — until ritmarecords.com is a
   verified sending domain in Resend, Resend only delivers from the default
   `onboarding@resend.dev` address to the email the Resend account itself
   was signed up with. It will silently fail (logged, not thrown — never
   blocks the order) to send to actual customers until you verify the
   domain: Resend dashboard → Domains → Add ritmarecords.com → add the
   SPF/DKIM records it gives you into Netlify's DNS panel (Domain
   management → DNS records) → wait for verification → then set
   `RESEND_FROM` to something like `Ritma Records <orders@ritmarecords.com>`.

Fulfillment details (customer contact + delivery address) show up on
`/dashboard`'s Recent Orders — click **View** on any order.

## Turning on real Bayarcash payments

Right now checkout shows the order total instead of charging a card,
because there's no Bayarcash merchant account connected yet — nothing is
broken, this is the intended placeholder behavior.

When ready to go live:

1. Sign up for a Bayarcash merchant account at https://bayar.cash.
2. In Netlify: **Site settings → Environment variables**, add:
   - `BAYARCASH_API_SECRET_KEY`
   - `BAYARCASH_PORTAL_KEY`
   - `BAYARCASH_MODE` (`sandbox` while testing, `production` when live)
   - `SITE_URL` (your live site URL)
3. Before flipping this on for real customers, verify the request/checksum
   details in `netlify/functions/create-bayarcash-payment.js` against
   Bayarcash's current docs (https://docs.bayarcash.com) or their official
   PHP SDK (https://github.com/webimpian/bayarcash-php-sdk) — the endpoint
   path and checksum algorithm in that file are a best-effort scaffold and
   are flagged with `TODO` comments where they need confirming.
4. Redeploy. Checkout will then redirect to a real Bayarcash payment page
   automatically — no frontend changes needed.

## Contact & Request-Item forms

Both `contact.html` and `request.html` use [Netlify
Forms](https://docs.netlify.com/manage/forms/setup/) — submissions show up
in your Netlify dashboard under **Forms**, no backend code required. You can
turn on email notifications for new submissions in that same dashboard.

## Known gaps / next steps

- **No customer accounts or order history** — deliberate, not a gap:
  checkout is guest-only by design (name/phone/email per order), no login.
  `account.html` is still a placeholder page as a result.
- **Customer receipt emails need a verified Resend domain** — see
  "Checkout, shipping & order emails" above. Admin notifications work as
  soon as `RESEND_API_KEY` is set; customer receipts need the extra domain
  verification step or they'll silently not send.
- **Bayarcash checksum/endpoint need verification** — see above. The
  webhook's status-field detection (`bayarcash-webhook.js`) is also still a
  best guess until a real callback payload has been seen — see the TODOs
  in that file.
- **Dashboard auth is a single shared passcode, not real accounts** — one
  `DASHBOARD_PASSCODE` checked on every admin request (`lib/auth.js`), no
  sessions/expiry/per-user login. Fine for one admin; revisit if that
  changes.
