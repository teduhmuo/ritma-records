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

## Manual bank transfer (interim payment method, before Bayarcash)

Bayarcash isn't connected yet, so right now every order falls back to a
manual bank-transfer flow instead of a real payment page:

1. Customer checks out → order is saved with `status: 'pending'` and
   `payment_method: 'bank_transfer'`.
2. An **invoice email** is sent immediately from `hello@ritmarecords.com`
   (`lib/order-emails.js` → `sendInvoiceEmail`) with the itemized order,
   total, and your bank details, telling the customer to transfer using
   the order number as the reference.
3. The confirmation page (`order-confirmation.html`) also shows the same
   bank details as a fallback in case the email is missed.
4. You check Maybank, match the incoming transfer to the order number,
   then open `/dashboard` → Overview → find the order → **Mark as Paid**.
   This calls `admin-mark-order-paid.js`, which decrements stock, flips
   the order to `paid`, and sends the normal customer confirmation email —
   the same thing a real Bayarcash payment would trigger automatically.

**Required setup:**

1. In Netlify: **Project configuration → Environment variables**, add:
   - `BANK_NAME` — e.g. `Maybank`
   - `BANK_ACCOUNT_NAME` — e.g. `Kedai Rekod Ritma`
   - `BANK_ACCOUNT_NUMBER` — e.g. `5514 1815 3718`
2. In Supabase (SQL Editor), run:
   ```sql
   ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'bayarcash';
   ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_link text;
   ```
   The first lets existing rows (all pre-Bayarcash, pre-this-feature orders)
   default sensibly without breaking anything already in the table. The
   second is used by the shipping/pickup fulfilment step below.
3. **Same Resend domain-verification caveat as above applies here** — the
   invoice email is a customer-facing email, so until ritmarecords.com is
   a verified sending domain in Resend, it will silently fail to reach
   real customers (logged, not thrown). Until that's done, treat the
   bank details shown on the confirmation page as the reliable fallback,
   not the email.

Once a real Bayarcash merchant account is connected (see below), new
orders automatically switch back to `payment_method: 'bayarcash'` and
skip this flow entirely — no code changes needed, it's driven by whether
`BAYARCASH_API_SECRET_KEY`/`BAYARCASH_PORTAL_KEY` are set.

## Shipping & pickup fulfilment (post-payment status)

Once an order is `paid` (however it got there — Bayarcash or the manual
flow above), the dashboard shows one more action depending on how the
customer chose to receive their order:

- **Shipping orders** → **Mark Shipped** button. Prompts for a tracking
  link (must be a full `http(s)://` URL), sets status to `shipped`, and
  emails the customer a "Your order has shipped" email with a Track
  Your Package button linking to it.
- **Self-pickup orders** → **Ready for Pickup** button. No extra info
  needed — sets status to `ready_for_pickup` and emails the customer.

Both live in `netlify/functions/admin-update-order-fulfilment.js`, and
both require the SQL migration above (`tracking_link` column) to be run
first. `shipped` and `ready_for_pickup` still count as "paid" for
revenue/stock stats on the Overview tab — they're fulfilment states
that happen after payment, not a separate track.

## Turning on real Bayarcash payments

Right now checkout falls back to the manual bank-transfer flow above
instead of charging a card, because there's no Bayarcash merchant account
connected yet — nothing is broken, this is the intended placeholder
behavior.

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

Both `contact.html` and `request.html` submit to Supabase (via
`submit-message.js`) rather than Netlify Forms — that kept submissions
locked inside Netlify's own system, invisible to the custom dashboard.
Now they show up under **`/dashboard` → Messages**, with a "new" count
badge and a New/Read/Done status you can track per message.

A notification email fires on every submission too — set
`MESSAGE_NOTIFICATION_EMAIL` in Netlify's environment variables (falls
back to `ADMIN_NOTIFICATION_EMAIL` if that's not set). Same Resend
domain-verification caveat as order receipts applies here: until
ritmarecords.com is verified in Resend, this can only actually deliver to
whatever email the Resend account itself was signed up with.

Both forms still carry `data-netlify="true"` and the hidden honeypot field
as a no-JS fallback — if a visitor's JavaScript fails to load for any
reason, the form still submits somewhere (Netlify's own Forms system)
rather than silently going nowhere. The honeypot itself is reused for the
Supabase path too: if that hidden field comes through filled in, the
submission is silently discarded (looks like success, saves nothing, no
email) rather than telling a bot it's been caught.

## Known gaps / next steps

- **No customer accounts or order history** — deliberate, not a gap:
  checkout is guest-only by design (name/phone/email per order), no login.
  `account.html` is still a placeholder page as a result.
- **Customer receipts AND message notifications need a verified Resend
  domain** — see above. Admin/message notifications work as soon as their
  respective env vars are set; customer-facing emails need the extra
  domain verification step or they'll silently not send.
- **Bayarcash checksum/endpoint need verification** — see above. The
  webhook's status-field detection (`bayarcash-webhook.js`) is also still a
  best guess until a real callback payload has been seen — see the TODOs
  in that file.
- **Dashboard auth is a single shared passcode, not real accounts** — one
  `DASHBOARD_PASSCODE` checked on every admin request (`lib/auth.js`), no
  sessions/expiry/per-user login. Fine for one admin; revisit if that
  changes.
