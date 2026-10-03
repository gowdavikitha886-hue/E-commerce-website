# API reference

ShopEase exposes a conventional REST-shaped API. In this project it is simulated
in-browser (section 5 of `index.html`), but every path, payload, status code and
error message below is what a real server would implement — see the swap guide in
[ARCHITECTURE.md](ARCHITECTURE.md#swapping-in-a-real-backend).

- **Base URL:** `/api`
- **Content type:** `application/json`
- **Auth:** `Authorization: Bearer <token>` (in-browser: `sessionStorage.se_token`)
- **Total endpoints:** 38

---

## Conventions

### Success envelope

The simulated server returns `{ status, data }` internally. The client unwraps it
and returns `data` directly, throwing an `Error` for any `status >= 400`. So
callers see plain objects on success and exceptions on failure:

```js
const cart = await api('GET', '/api/cart');   // -> the cart totals object
await api('POST', '/api/cart', { productId: 3 });  // -> throws Error('...')
```

### Error envelope

| Field | Type | Notes |
| --- | --- | --- |
| `error` | string | Human-readable, safe to show to the user |
| `status` | number | Attached to the thrown `Error` as `err.status` |

Error messages are written for shoppers, not developers: `"Only 3 of Wireless
Earbuds allowed per order"` rather than `"422 validation_failed"`.

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | Read or update succeeded |
| 201 | Resource created |
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Authenticated but not permitted |
| 404 | No such resource |
| 409 | Conflict (duplicate email, insufficient stock) |
| 500 | Unhandled server error |

### Validation patterns

| Field | Rule | Regex |
| --- | --- | --- |
| Name | 2–60 chars | `/^.{2,60}$/` |
| Email | standard | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| Phone | Indian mobile, 10 digits, starts 6–9 | `/^[6-9]\d{9}$/` |
| PIN code | exactly 6 digits | `/^\d{6}$/` |
| UPI ID | `handle@bank` | `/^[\w.-]+@[\w-]+$/` |
| Card | 16 digits, spaces allowed | `/^\d{16}$/` after stripping spaces |

### Access levels

| Middleware | Meaning |
| --- | --- |
| *(none)* | Public |
| `optAuth` | Works anonymously; resolves the user if a valid token exists. Used for the cart so guests and members share one cart. |
| `auth` | Requires a valid token |
| `admin` | Requires a valid token **and** `role === 'admin'` |

### Anonymous cart

When no token is present, `uidOf()` resolves to the string `'guest'`. All cart
routes accept guests. On login or signup the guest cart is **merged** into the
account cart (quantities for shared products are summed) and the guest cart is
cleared.

---

## Authentication

### `POST /api/auth/signup`

Creates an account and merges any guest cart into it. → **201**

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | 2–60 characters |
| `email` | string | yes | Lowercased before storage |
| `password` | string | yes | Minimum 6 characters, SHA-256 hashed |

**Response**

```json
{
  "token": "eyJ1aWQiOjMsInJvbGUiOiJ1c2VyIiwiZXhwIjoxNzI...}.9f2a...",
  "user": { "id": 3, "name": "Riya Sharma", "email": "riya@example.com", "role": "user" }
}
```

**Errors** · `400` invalid name/email/password · `409` email already registered

---

### `POST /api/auth/login`

**Body:** `{ "email": "...", "password": "..." }` → **200**, same shape as signup.

**Errors** · `401` "Wrong email or password" (deliberately vague — never reveal
whether the email exists)

---

### `GET /api/auth/me` 🔒 `auth`

Returns the current user. Used on boot to restore a session.

**Response**

```json
{ "id": 3, "name": "Riya Sharma", "email": "riya@example.com", "role": "user", "joined": 1730000000000 }
```

**Errors** · `401`

> **Token format.** `base64(JSON claims) + "." + SHA-256(claims + SECRET)`.
> Claims are `{ uid, role, exp }` with `exp = now + CONFIG.tokenTtlMs` (1 hour).
> The signature is checked first, so a tampered payload fails at the `===` guard.
> Tokens live in `sessionStorage`, so closing the tab logs you out.

---

## Products

### `GET /api/products`

The catalogue endpoint. Powers the grid, every filter and all faceting.

**Query parameters**

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `search` | string | `""` | Case-insensitive match over name, brand, category **and** description |
| `category` | string | `All` | `"All"` disables the category filter |
| `brand` | string | `""` | Exact brand match |
| `min` | number | `0` | Inclusive minimum price |
| `max` | number | `0` | Inclusive maximum price; `0` means no ceiling |
| `rating` | number | `0` | Minimum average rating |
| `inStock` | `0`\|`1` | `0` | `1` hides sold-out products |
| `sort` | string | `new` | `new` \| `rating` \| `reviews` \| `low` \| `high` \| `name` |
| `page` | number | `1` | 1-based |
| `limit` | number | `12` | Page size |

**Response**

```json
{
  "items": [ { "id": 1, "name": "Wireless Earbuds", "emoji": "🎧", "category": "Electronics",
               "brand": "SonicWave", "price": 2499, "rating": 4.5, "baseRating": 4.5,
               "reviewCount": 2, "stock": 12, "desc": "Active noise cancelling...", "created": 1730000000000 } ],
  "total": 20,
  "pages": 2,
  "page": 1,
  "categories": ["All", "Electronics", "Fashion", "Home", "Sports", "Stationery"],
  "brands": ["SonicWave", "PulseTrack", "Northloom", "..."],
  "counts": { "Electronics": 4, "Fashion": 4, "Home": 5, "Sports": 3, "Stationery": 4 },
  "priceBounds": { "min": 0, "max": 12999 }
}
```

`categories`, `brands`, `counts` and `priceBounds` are computed from the **whole**
catalogue, not the filtered result, so the filter rail stays stable while you
narrow down.

---

### `GET /api/products/suggest`

Autocomplete backing. Match quality: name-prefix matches outrank everything else,
then by match position.

**Query:** `?q=yoga`

**Response**

```json
{
  "suggestions": [
    { "id": 9, "name": "Yoga Mat", "brand": "FlowFit", "price": 699, "emoji": "🧘", "stock": 30 }
  ],
  "categories": ["Sports"]
}
```

Empty or missing `q` returns `{ "suggestions": [], "categories": [] }`.

---

### `GET /api/products/:id`

Single product **plus** context the detail dialog needs in one round trip.

```json
{
  "id": 1, "name": "...", "price": 2499, "stock": 12, "rating": 4.5, "reviewCount": 2,
  "related": [ /* up to 6 same-category products, best rated first */ ],
  "inCart": false,
  "inWishlist": true
}
```

**Errors** · `404` "Product not found"

> ⚠️ Registered **after** `/api/products/suggest` and `/api/products/export.csv`.
> The router is first-match-wins, so static paths must be declared first.

---

### `POST /api/products` 🔒 `admin`

**Body:** `{ name, emoji, category, brand, price, stock, desc, image }`

`name` and `category` are required and `price` must be > 0. `emoji` defaults to
📦, `image` to empty, `rating` to 4. Sets `created`, `reviewCount: 0`. → **201**

**Errors** · `400` "Name, category and a price above 0 are required"

---

### `PUT /api/products/:id` 🔒 `admin`

Same body as create. Partial catalogue edits are not supported — send the full
object. Preserves `baseRating` when the product has no reviews yet. → **200**

**Errors** · `400` invalid data · `404`

---

### `DELETE /api/products/:id` 🔒 `admin`

Removes the product **and** cascades: matching reviews are deleted and the product
is stripped from every stored cart. Existing orders keep their item snapshot, so
historical invoices stay intact. → **200** `{ "deleted": true }`

---

### `GET /api/products/export.csv` 🔒 `admin`

> Registered **before** `/api/products/:id` or the `:id` route swallows it.

**Response**

```json
{
  "filename": "shopease-products.csv",
  "csv": "name,emoji,category,brand,price,stock,desc\nWireless Earbuds,🎧,Electronics,SonicWave,2499,12,Active noise..."
}
```

Escaping is RFC-4180: values containing a comma, quote or newline are quoted, and
internal quotes are doubled.

---

### `POST /api/products/import` 🔒 `admin`

**Body:** `{ "csv": "name,category,price\nWidget,Test,199" }`

- First row is the header; column order is taken from it, case-insensitively.
- Requires at least `name` and `price`; other columns are optional and ignored.
- Rows are matched to existing products **by case-insensitive name** — matches
  update, new names create. So re-importing an export is a safe no-op.
- Bad rows are collected rather than aborting the batch.

**Response**

```json
{ "created": 2, "updated": 18, "errors": ["Row 7: name and a price above 0 are required"] }
```

**Errors** · `400` missing header row, or header lacks `name`/`price`

---

## Reviews

### `GET /api/products/:id/reviews`

**Query:** `?page=1` (5 per page)

**Response**

```json
{
  "items": [ { "id": 4, "pid": 1, "uid": 2, "name": "Riya Sharma", "rating": 5,
               "title": "Battery is unreal", "body": "Paired instantly...",
               "verified": true, "status": "published", "created": 1730000000000 } ],
  "total": 8, "pages": 2, "page": 1,
  "dist": [ { "star": 5, "n": 3 }, { "star": 4, "n": 1 }, { "star": 3, "n": 0 },
            { "star": 2, "n": 0 }, { "star": 1, "n": 0 } ],
  "summary": { "average": 4.5, "count": 2 },
  "canReview": true
}
```

`dist` always has five entries in 5→1 order and sums to `total`. Only
`status === 'published'` reviews are returned and counted.

---

### `POST /api/products/:id/reviews` 🔒 `auth`

**Body:** `{ rating, title, body }`

`rating` must be 1–5, `title` ≥ 3 chars, `body` ≥ 10 chars. `verified` is computed
server-side by checking for a non-cancelled order containing the product — clients
cannot set it themselves. → **201**

**Errors** · `400` rating/title/body validation · `401` · `404`

> Adding a review calls `recomputeRatings()`, which re-derives `rating` and
> `reviewCount` for **every** product and saves once. Folding a review into the
> product's cached average keeps list queries to a single collection read.

---

### `DELETE /api/reviews/:id` 🔒 `auth`

Allowed for the review's author **or** any admin. Recomputes ratings. → **200** `{ "deleted": true }`

**Errors** · `403` "You can only delete your own review" · `404`

---

## Wishlist

All three accept guests (`optAuth`); each account gets its own list.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/wishlist` | — | `{ items: [product], total: n }` |
| `POST /api/wishlist` | `{ productId }` | `{ items: n, added: true }` |
| `DELETE /api/wishlist/:pid` | — | `{ items: n }` |

`POST` is **idempotent** — saving an already-saved product does not duplicate it.
New saves go to the front of the list.

### `POST /api/wishlist/:pid/move-to-cart`

Adds one unit to the cart **and** removes the item from the wishlist in a single
call, so the two lists can never disagree. Returns `{ cart: <cart totals> }`.

**Errors** · `400` out of stock, or the per-order cap would be exceeded

---

## Recently viewed

| Endpoint | Body | Notes |
| --- | --- | --- |
| `GET /api/recent` | — | `{ items: [product] }`, newest first, capped at `CONFIG.recentMax` (12) |
| `POST /api/recent` | `{ productId }` | Moves to front, de-duplicated |

---

## Cart

### `GET /api/cart` · `optAuth`

The pricing engine. Returns fully joined, live data:

```json
{
  "items": [ { "pid": 1, "qty": 2, "p": { /* live product record */ } } ],
  "sub": 4998, "disc": 500, "tax": 810, "ship": 0, "total": 5308,
  "coupon": "SAVE10", "couponError": null,
  "freeShipGap": 0, "eta": "12 Oct 2026"
}
```

**Pricing rules** (all in one place — the `totals()` function)

```
sub     = Σ (product.price × qty)
disc    = percent → round(sub × value / 100)
          flat    → min(value, sub)
          only if sub ≥ coupon.min and the coupon is live and unexpired
tax     = round((sub − disc) × 0.18)          ← taxed on the discounted base
ship    = 0 if (sub − disc) ≥ 999, else 49
total   = sub − disc + tax + ship
```

Items are joined to **live** product records on every read, so a price change or
deletion is reflected immediately rather than frozen at add-to-cart time.
`couponError` explains why a coupon silently isn't applying (`"That coupon has
expired"`, `"Spend ₹1,500 to use WELCOME20"`) so the cart can warn the shopper
instead of quietly dropping the discount.

---

### `POST /api/cart` · `optAuth`

**Body:** `{ productId, qty }` (default 1) → **201**

Quantity is capped at `min(product.stock, CONFIG.maxQtyPerItem)` **including what
is already in the cart**.

**Errors** · `400` "This item is out of stock" / "Only 3 of Wireless Earbuds
allowed per order" · `404`

---

### `PUT /api/cart/:pid` · `optAuth`

**Body:** `{ qty }` → **200** with fresh totals.

**Errors** · `400` qty < 1 or above the cap · `404`

---

### `DELETE /api/cart/:pid` · `optAuth`

→ **200** with fresh totals **plus** `removed: { pid, qty }`.

That echo is what powers the **Undo** toast — the client re-POSTs the exact
quantity without having to remember it.

---

### `DELETE /api/cart/coupon` · `optAuth`

Clears the applied coupon and re-prices. → **200**

> Registered **before** `/api/cart/:pid` or `:pid` would match the literal
> string `"coupon"`.

---

## Coupons

### `GET /api/coupons`

Live, unexpired coupons. Backs the one-tap chips in the cart. → **200**
`[{ code, type, value, min, expires, note, used }]`

### `POST /api/coupons/apply` · `optAuth`

**Body:** `{ code }` — uppercased and trimmed. → **200** with fresh totals.

**Errors** · `400` "That coupon code does not exist" / "`WELCOME20` expired on 30
Jun 2027" / "Add ₹402 more to use SAVE10 (minimum ₹500)"

---

## Address book 🔒 `auth`

| Endpoint | Notes |
| --- | --- |
| `GET /api/addresses` | Sorted default-first |
| `POST /api/addresses` | → **201**. The first address becomes the default automatically |
| `PUT /api/addresses/:id` | Setting `isDefault` clears it on every other address |
| `DELETE /api/addresses/:id` | If the default was deleted, the next address is promoted |

**Body:** `{ label, name, phone, pin, city, address, isDefault }`

`label` defaults to `"Home"`. Validation per [conventions](#validation-patterns);
`address` must be ≥ 8 characters.

**Errors** · `400` field validation · `403`/`404` — an address belonging to another
user is reported as `404`, not `403`, to avoid confirming that it exists.

---

## Orders 🔒 `auth`

### `POST /api/orders`

Places the order. In order:

1. Cart must be non-empty.
2. Shipping and payment validated.
3. **Every line re-checked against live stock** → `409` if anything sold out.
4. Stock decremented.
5. Coupon usage counter incremented.
6. Cart cleared.
7. Order stored with an immutable item snapshot and a status `history` array.

**Body**

```json
{
  "shipping": { "label": "Home", "name": "Riya Sharma", "email": "riya@example.com",
                "phone": "9876543210", "pin": "560001", "city": "Bengaluru",
                "address": "12 MG Road" },
  "payment": { "method": "card", "card": "4242 4242 4242 4242" }
}
```

`payment.method` ∈ `cod` | `card` | `upi`.

**Response** → **201**

```json
{
  "id": "SE-20261003-001", "uid": 2, "user": "Riya Sharma", "email": "riya@example.com",
  "date": "2026-10-03T09:14:22.101Z", "status": "Placed",
  "history": [ { "status": "Placed", "at": "2026-10-03T09:14:22.101Z", "note": "Payment method: CARD" } ],
  "shipping": { "...": "..." },
  "payment": { "method": "card", "last4": "4242", "upi": null },
  "items": [ { "pid": 1, "name": "Wireless Earbuds", "emoji": "🎧", "price": 2499, "qty": 2 } ],
  "sub": 4998, "disc": 500, "tax": 810, "ship": 0, "total": 5308, "coupon": "SAVE10"
}
```

**Design notes**

- **IDs are human-quotable:** `SE-<YYYYMMDD>-<3-digit sequence>`.
- **Items are snapshotted**, not referenced. Renaming or deleting a product later
  never rewrites history.
- **Only `last4` is stored for cards.** The full number is never persisted.
- The stock re-check (step 3) closes the race where two shoppers check out the last
  unit simultaneously — the loser gets `409` and nothing is deducted.

---

### `GET /api/orders`

The caller's orders, newest first.

### `GET /api/orders/:id`

One order. Owners see their own; admins see any. → `404` otherwise.

### `PUT /api/orders/:id/cancel`

Only while `Placed` or `Packed`. **Returns every line's quantity to stock** and
appends a `Cancelled` history entry. → **200**

**Errors** · `400` "Shipped orders can no longer be cancelled" · `404`

---

## Admin 🔒 `admin`

### `GET /api/admin/orders`

All orders, newest first.

### `PUT /api/admin/orders/:id/status`

**Body:** `{ status }` ∈ `Placed` | `Packed` | `Shipped` | `Delivered` | `Cancelled`.
Appends to `history`. → **200**

### `GET /api/admin/dashboard`

Everything the admin home page needs, in one call:

| Field | Meaning |
| --- | --- |
| `revenue` | Sum of non-cancelled order totals |
| `orders` / `paidOrders` | All orders / non-cancelled orders |
| `aov` | Average order value |
| `users` / `products` | Catalogue and account counts |
| `catalogueValue` | `Σ price × stock` |
| `by` | Order count per status |
| `days` | 7-day series: `{ date, label, orders, revenue }` |
| `topProducts` | Top 5 by units sold |
| `lowStock` | `0 < stock ≤ CONFIG.lowStockAt` |
| `outOfStock` | `stock === 0` |
| `recentOrders` | Latest 6 |

Revenue excludes cancelled orders; the 7-day series sums exactly to `revenue`.

### Coupons

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/coupons` | All coupons including paused and expired |
| `POST /api/admin/coupons` | → **201** |
| `PUT /api/admin/coupons/:id` | Toggle `active`, change `expires` / `min` / `note` |
| `DELETE /api/admin/coupons/:id` | Also strips the code from every stored cart |

**Body:** `{ code, type, value, min, expires, note, active }`

Codes are normalised to `[A-Z0-9]` and capped at 12 characters. Percentages above
90 are rejected.

**Errors** · `400` code too short, bad type, non-positive value, "Percentage
discount cannot exceed 90%", missing expiry · `409` duplicate code · `404`

### `GET /api/admin/reviews`

All reviews with their joined product, for the moderation view.

---

## Quick reference

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/auth/signup` | — |
| POST | `/api/auth/login` | — |
| GET | `/api/auth/me` | auth |
| GET | `/api/products` | — |
| GET | `/api/products/suggest` | — |
| GET | `/api/products/export.csv` | admin |
| POST | `/api/products/import` | admin |
| GET | `/api/products/:id` | — |
| POST | `/api/products` | admin |
| PUT | `/api/products/:id` | admin |
| DELETE | `/api/products/:id` | admin |
| GET | `/api/products/:id/reviews` | — |
| POST | `/api/products/:id/reviews` | auth |
| DELETE | `/api/reviews/:id` | auth/admin |
| GET | `/api/wishlist` | optAuth |
| POST | `/api/wishlist` | optAuth |
| DELETE | `/api/wishlist/:pid` | optAuth |
| POST | `/api/wishlist/:pid/move-to-cart` | optAuth |
| GET | `/api/recent` | optAuth |
| POST | `/api/recent` | optAuth |
| GET | `/api/cart` | optAuth |
| POST | `/api/cart` | optAuth |
| PUT | `/api/cart/:pid` | optAuth |
| DELETE | `/api/cart/coupon` | optAuth |
| DELETE | `/api/cart/:pid` | optAuth |
| GET | `/api/coupons` | — |
| POST | `/api/coupons/apply` | optAuth |
| GET | `/api/addresses` | auth |
| POST | `/api/addresses` | auth |
| PUT | `/api/addresses/:id` | auth |
| DELETE | `/api/addresses/:id` | auth |
| POST | `/api/orders` | auth |
| GET | `/api/orders` | auth |
| GET | `/api/orders/:id` | auth |
| PUT | `/api/orders/:id/cancel` | auth |
| GET | `/api/admin/orders` | admin |
| PUT | `/api/admin/orders/:id/status` | admin |
| GET | `/api/admin/dashboard` | admin |
| GET | `/api/admin/coupons` | admin |
| POST | `/api/admin/coupons` | admin |
| PUT | `/api/admin/coupons/:id` | admin |
| DELETE | `/api/admin/coupons/:id` | admin |
| GET | `/api/admin/reviews` | admin |