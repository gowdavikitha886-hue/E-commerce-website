# ShopEase

A complete, production-shaped e-commerce storefront that ships as **one HTML file**.
The frontend and a simulated REST backend share the same document, and every byte of
data lives in the browser's `localStorage` — no build step, no server, no dependencies.

```
E-commerce website/
├─ index.html          the entire application
├─ README.md           you are here
├─ docs/
│  ├─ API.md           every endpoint, with request/response examples
│  ├─ ARCHITECTURE.md  layering, data model, flows, design decisions
│  ├─ UIUX.md          design system, components, accessibility
│  └─ TESTING.md       how to verify the project
└─ tests/
   ├─ extract.mjs      splits index.html into checkable modules
   └─ test-api.mjs     93 assertions against the API layer
```

---

## Quick start

Open `index.html` in any modern browser. That is the entire install.

```bash
# macOS
open index.html
# Windows
start index.html
# or just double-click it
```

On first load the app seeds a 20-product catalogue, five coupons, two demo accounts
and eight starter reviews. It takes about a second.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | `shopper@shopease.com` | `shopper123` |
| Admin | `admin@shopease.com` | `admin123` |

The login dialog has one-click **Fill customer** / **Fill admin** buttons.

### Running the tests

```bash
node tests/extract.mjs    # split index.html and syntax-check it
node tests/test-api.mjs   # run the API test suite
```

See [docs/TESTING.md](docs/TESTING.md).

---

## Features

### Shopping

- **Catalogue** — 20 seeded products across 6 categories and 14 brands, with emoji
  or image thumbnails, stock levels and delivery estimates.
- **Filtering** — category with live counts, brand chips, minimum/maximum price,
  minimum rating, in-stock-only, and removable "active filter" pills.
- **Sorting** — newest, top rated, most reviewed, price both ways, name A–Z.
- **Search** — debounced autocomplete over name, brand and category with
  match highlighting and full keyboard navigation (arrows, Enter, Escape).
- **Two layouts** — grid for browsing, list for scanning, remembered between visits.
- **Pagination** — 12 per page with a live "showing 1–12 of 20" counter.
- **Recommendations** — "Recently viewed" and "Top rated right now" rails.

### Cart and checkout

- Slide-out cart with a **free-shipping progress meter** that fills as you spend.
- Quantity steppers capped by both stock and the 10-per-order limit.
- **Undo** on removal — remove a line by mistake and put it straight back.
- Coupons with live validation: minimum-spend messaging, expiry checks, and a
  one-tap chip list of codes that currently work on your cart.
- Itemised totals: subtotal, discount, GST at 18%, shipping, grand total.
- **Three-step checkout** — shipping → payment → review — with a progress stepper.
- Saved **address book** with a default address; addresses added at checkout are
  remembered for next time.
- Payment methods: cash on delivery, UPI, card (validated, last 4 stored only).
- The anonymous cart is **merged into your account** when you log in.

### Accounts and reviews

- Sign up / log in with hashed passwords and expiring signed tokens.
- **Wishlist** with move-to-cart and clear-all.
- **Recently viewed** history, capped at 12.
- **Product reviews** — 1–5 stars, headline and body, with an average score and a
  5-star distribution histogram. Reviews from people who actually bought the item
  are badged **Verified purchase**.
- Order history with a **tracking timeline** showing when each status was reached.
- **Printable / save-as-PDF invoices** with a dedicated print stylesheet.
- Cancel an order while it is unshipped — stock is returned automatically.

### Admin

- **Dashboard** — revenue, average order value, customer count, stock value, a
  7-day revenue bar chart, a status breakdown donut, and best sellers.
- **Inventory alerts** — low-stock and out-of-stock lists.
- **Catalogue management** — full CRUD with search, bulk **CSV import/export**,
  and import validation that reports bad rows without aborting the batch.
- **Coupon management** — create, pause, edit and delete promotions.
- **Order fulfilment** — advance status through Placed → Packed → Shipped →
  Delivered, with an audit trail on every change.
- **Review moderation** — read and delete customer reviews.

### Interface

- Light and dark themes, defaulting to your OS preference and persisted locally.
- Full keyboard control, with a `?` cheatsheet.
- Focus-trapped dialogs, skip-to-content link, live regions for result counts
  and toasts, labelled controls, and visible focus rings.
- Honours `prefers-reduced-motion` and `prefers-color-scheme`.
- Skeleton loaders, purposeful empty states, and toasts with inline actions.
- Responsive from 320px up, with a collapsing filter rail on mobile.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `↓` `↑` `Enter` | Navigate and choose search suggestions |
| `c` | Open / close the cart |
| `w` | Wishlist |
| `g` then `s` | Shop |
| `g` then `o` | My orders |
| `g` then `a` | Address book |
| `t` | Toggle theme |
| `Esc` | Close any dialog or the drawer |
| `?` | Show the shortcut cheatsheet |

---

## Configuration

Business rules live in a single `CONFIG` object at the top of the script:

```js
const CONFIG = {
  taxRate: 0.18,           // GST
  freeShippingAbove: 999,  // free delivery threshold, rupees
  shippingFee: 49,         // flat fee below the threshold
  maxQtyPerItem: 10,       // per-order limit
  lowStockAt: 6,           // admin low-stock alert threshold
  recentMax: 12,           // recently-viewed cap
  tokenTtlMs: 36e5         // session token lifetime (1 hour)
};
```

Change a value and the whole app — pricing, copy, thresholds, charts — follows.

---

## Swapping in a real backend

The app never touches storage directly. All UI code calls a single async client:

```js
const api = async (method, url, body) => { /* simulated server in this file */ };
```

Replace its body with `fetch` and the rest of the application keeps working
unchanged, because every route, status code and error message already matches a
conventional REST shape:

```js
const api = async (method, url, body) => {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionStorage.getItem('se_token') && { Authorization: 'Bearer ' + sessionStorage.getItem('se_token') })
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};
```

Then delete sections 3–5 of the script (database, seed, simulated server) and point
the real server at the same paths. The full contract is in [docs/API.md](docs/API.md).

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/API.md](docs/API.md) | All 38 endpoints, auth, validation rules, examples |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, data model, request flows, decisions |
| [docs/UIUX.md](docs/UIUX.md) | Design tokens, components, accessibility, responsiveness |
| [docs/TESTING.md](docs/TESTING.md) | Test suite, coverage, manual QA checklist |

---

## Notes and limitations

This is a **demonstration project**, and it is honest about that:

- **No real payments.** Card and UPI fields are format-validated only. Nothing is
  charged and no card data leaves the page. Only the last 4 digits are stored.
- **No server.** Data lives in `localStorage` under the `se_` prefix. Clearing
  site data resets the app. *Account → Reset all demo data* does the same thing.
- **Passwords** are SHA-256 hashed before storage, which protects a casual
  shoulder-surfer but is not a substitute for server-side bcrypt/argon2.
- **The router is first-match-wins**, so static paths must be registered before
  parameterised ones (`/api/products/export.csv` before `/api/products/:id`).
- Single file means single-file tooling: no modules, no bundler, no TypeScript.
  See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layering that keeps it
  navigable anyway.