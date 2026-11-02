# Payment gateway integration guide (Stripe Checkout)

Status: **design + implementation guide — not yet built into the app.**
Recommendation: **Stripe Checkout** (hosted payment page). Vision-Tax serves US taxpayers, and Checkout means card data
never touches your server (PCI scope stays at the lightest level, SAQ‑A). Alternatives are listed at the end.

---

## 1. Business flow

Fee per filing, paid by the client. Two sensible models — pick one before building:

| Model | When the client pays | Effect on the existing lifecycle |
|---|---|---|
| **A. Pay at submission** (recommended) | After submitting a filing | Filing stays hidden from the admin queue until `paid` |
| **B. Pay before final download** | When the draft is ready | `completed` stays, but final files are released only when `paid` |

Model A is simplest and protects your time. The guide below uses A; B differs only in the check in step 6.

```
Client submits filing ──► POST /api/user/filings        (status=pending, payment_status=unpaid)
        │
        ▼
Client clicks "Pay"   ──► POST /api/payments/checkout    (server creates Stripe Checkout Session)
        │                  └─ returns { url } → browser redirects to Stripe
        ▼
Client pays on Stripe ──► redirect to /dashboard/filings?paid=1
        │
        ▼
Stripe ──► POST /api/payments/webhook (signed)  ──► payment_status=paid  ◄── source of truth
```

**Never trust the browser redirect.** Only the verified webhook marks a filing as paid.

---

## 2. Stripe account setup (once)

1. Create an account at stripe.com and complete business verification (needed for live payments).
2. Dashboard → *Developers → API keys*: copy the **secret key** (`sk_test_…` first, `sk_live_…` later).
3. Dashboard → *Developers → Webhooks → Add endpoint*:
   - URL: `https://YOUR-DOMAIN/api/payments/webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
   - Copy the **signing secret** (`whsec_…`).
4. For local testing install the Stripe CLI: `stripe listen --forward-to localhost:4000/api/payments/webhook`
   (it prints a temporary `whsec_…`).

Add to `server/.env` (and `.env.example` with blank values):

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
PUBLIC_URL=http://localhost:3000        # where Stripe sends the client back (= CLIENT_ORIGIN)
```

---

## 3. Database — new migration `database/migrations/002_payments.sql`

```sql
CREATE TABLE IF NOT EXISTS prices (
  filing_type VARCHAR(30) NOT NULL,            -- matches filings.type (W2, 1099-B, …)
  amount_cents INT UNSIGNED NOT NULL,
  PRIMARY KEY (filing_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE filings
  ADD COLUMN payment_status ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid' AFTER status;

CREATE TABLE IF NOT EXISTS payments (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filing_id          INT UNSIGNED NOT NULL,
  user_id            INT UNSIGNED NOT NULL,
  amount_cents       INT UNSIGNED NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'usd',
  stripe_session_id  VARCHAR(100) NOT NULL,
  stripe_payment_intent VARCHAR(100) NULL,
  status             ENUM('created','paid','expired','refunded') NOT NULL DEFAULT 'created',
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at            TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_session (stripe_session_id),
  KEY idx_pay_filing (filing_id),
  CONSTRAINT fk_pay_filing FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Prices live in the database (seed them), **never in the browser** — the client must not be able to choose the amount.

---

## 4. Server code

Install: `cd server && npm install stripe`

`server/src/routes/payments.js`

```js
const express = require('express');
const Stripe = require('stripe');
const { pool, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncRoute } = require('../lib');
const { config } = require('../config');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// 1) Create a Checkout Session for one of the caller's own unpaid filings
router.post('/checkout', requireAuth(), requireRole('user'), asyncRoute(async (req, res) => {
  const filingId = Number(req.body?.filingId);
  const [[f]] = await pool.query(
    `SELECT f.id, f.type, f.filing_year, f.payment_status, p.amount_cents
       FROM filings f JOIN prices p ON p.filing_type = f.type
      WHERE f.id = ? AND f.user_id = ?`, [filingId, req.user.id]);
  if (!f) return res.status(404).json({ error: 'Filing not found.' });
  if (f.payment_status === 'paid') return res.status(409).json({ error: 'This filing is already paid.' });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: req.user.email,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: f.amount_cents,
        product_data: { name: `Tax filing – ${f.type} (${f.filing_year})` } },
    }],
    metadata: { filingId: String(f.id), userId: String(req.user.id) },
    success_url: `${process.env.PUBLIC_URL}/dashboard/filings?paid=1`,
    cancel_url:  `${process.env.PUBLIC_URL}/dashboard/filings?paid=0`,
  });
  await pool.query(
    'INSERT INTO payments (filing_id,user_id,amount_cents,stripe_session_id) VALUES (?,?,?,?)',
    [f.id, req.user.id, f.amount_cents, session.id]);
  res.json({ url: session.url });
}));

module.exports = router;

// 2) Webhook — mounted separately in index.js BEFORE express.json() (needs the raw body)
module.exports.webhook = asyncRoute(async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch { return res.status(400).send('Bad signature'); }

  if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
    const s = event.data.object;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // idempotent: only the first delivery flips created → paid
      const [r] = await conn.query(
        "UPDATE payments SET status='paid', paid_at=NOW(), stripe_payment_intent=? WHERE stripe_session_id=? AND status='created'",
        [s.payment_intent, s.id]);
      if (r.affectedRows) await conn.query("UPDATE filings SET payment_status='paid' WHERE id=?", [Number(s.metadata.filingId)]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }
  if (event.type === 'checkout.session.expired')
    await pool.query("UPDATE payments SET status='expired' WHERE stripe_session_id=? AND status='created'", [event.data.object.id]);
  if (event.type === 'charge.refunded') {
    const pi = event.data.object.payment_intent;
    await pool.query("UPDATE payments SET status='refunded' WHERE stripe_payment_intent=?", [pi]);
    await pool.query("UPDATE filings f JOIN payments p ON p.filing_id=f.id SET f.payment_status='refunded' WHERE p.stripe_payment_intent=?", [pi]);
  }
  res.json({ received: true });
});
```

`server/src/index.js` — register the webhook **before** `app.use(express.json(...))`, and add the router:

```js
const payments = require('./routes/payments');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), payments.webhook);
// … existing express.json() …
app.use('/api/payments', payments);
```

The CSRF origin check in `index.js` blocks non-matching `Origin` headers on POSTs. Stripe's webhook sends **no** `Origin`
header, so it passes; do not add the webhook to any allow-list.

Gate admin work on payment (Model A): in `admin.js` `GET /filings`, add `AND f.payment_status = 'paid'` to `where`,
and show unpaid filings to the client as "Awaiting payment".

---

## 5. Client changes

- `lib/api.js`: nothing new — `api('/payments/checkout', { method:'POST', body:{ filingId } })`.
- **My Filings** table: add a *Payment* column — `Paid` badge, or a **Pay now** button:

```jsx
async function pay(filingId) {
  const { url } = await api('/payments/checkout', { method: 'POST', body: { filingId } });
  window.location.assign(url);            // Stripe-hosted page
}
```

- After upload (`/dashboard/upload`), redirect to checkout immediately instead of `/dashboard/filings`.
- Show a toast from `?paid=1` ("Payment received — it may take a few seconds to confirm").
- Admin dashboard: add a *Revenue* card (`SELECT SUM(amount_cents) FROM payments WHERE status='paid'`) and a *Payment* column.
- Add a `payments` page under `/dashboard/payments` for receipts (Stripe emails receipts automatically if enabled
  in Dashboard → *Settings → Emails*).

---

## 6. Security checklist

- [ ] Amounts come from the `prices` table, never from the request.
- [ ] Webhook verifies the Stripe signature using the **raw** body.
- [ ] Webhook updates are idempotent (`WHERE status='created'`), Stripe retries deliveries.
- [ ] Ownership check on checkout (`f.user_id = req.user.id`).
- [ ] Secrets only in `server/.env` / host secret store; **never** commit them; use test keys until launch.
- [ ] HTTPS everywhere (Stripe live webhooks require it).
- [ ] Store no card data. Only Stripe IDs.
- [ ] Add refunds/disputes handling policy; publish a refund policy page (Stripe and card networks expect one).

## 7. Test plan (test mode)

| Scenario | How | Expected |
|---|---|---|
| Successful payment | card `4242 4242 4242 4242`, any future date/CVC | webhook → `payments.status=paid`, filing `paid` |
| Declined | `4000 0000 0000 0002` | stays `unpaid`, client can retry |
| 3‑D Secure | `4000 0025 0000 3155` | challenge shown, then paid |
| Abandon checkout | close tab | row stays `created`; `expired` after 24h |
| Replay webhook | `stripe events resend <id>` | no double update |
| Paying someone else's filing | call API with another `filingId` | 404 |

## 8. Alternatives

| Gateway | Good for | Notes |
|---|---|---|
| **Stripe** | US clients, cards, ACH, Apple/Google Pay | Best developer experience; recommended |
| PayPal | clients who prefer PayPal | Can be added next to Stripe |
| Razorpay | clients paying in INR from India | Not suited to USD tax-return fees |
| Zelle (already on site) | manual | No API; reconcile manually, mark paid from an admin button |

Rough effort: 1–2 days including tests, plus Stripe's business verification time.
