
/* ============================================================================
 *  ShopEase - single file storefront
 * ---------------------------------------------------------------------------
 *  The file is deliberately layered so the same file can act as frontend and
 *  backend. Replace section 3 (server) with real HTTP calls and the rest of the
 *  app keeps working.
 *
 *    1. Config            tunable business rules in one place
 *    2. Utilities         formatting, escaping, dates, CSV
 *    3. Database          localStorage-backed collection store
 *    4. Seed              demo catalogue on first run
 *    5. Backend           router + middleware + controllers (the "API")
 *    6. API client        the only thing the UI is allowed to call
 *    7. UI kernel         state, router, modal, toast, theme, helpers
 *    8. Storefront        hero, filters, grid/list, suggestions
 *    9. Product detail    gallery, specs, reviews
 *   10. Cart drawer       quantity, coupons, free-shipping meter
 *   11. Checkout          3-step wizard wired to the address book
 *   12. Orders            timeline, invoice, cancellation
 *   13. Account           wishlist, recently viewed, addresses, profile
 *   14. Admin             dashboard, catalogue, coupons, reviews, orders
 *   15. Shortcuts + boot
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 1. CONFIG
 * ------------------------------------------------------------------------- */
const CONFIG = {
  storeName: 'ShopEase',
  currency: '\u20b9',
  taxRate: 0.18,          // GST
  freeShippingAbove: 999,
  shippingFee: 49,
  maxQtyPerItem: 10,
  lowStockAt: 6,
  recentMax: 12,
  alsoLikeMax: 6,
  reviewsPerPage: 5,
  tokenTtlMs: 36e5,       // 1 hour
  adminEmail: 'admin@shopease.com',
  adminPassword: 'admin123',
  shopperEmail: 'shopper@shopease.com',
  shopperPassword: 'shopper123'
};

/* ---------------------------------------------------------------------------
 * 2. UTILITIES
 * ------------------------------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Escape untrusted text before it reaches innerHTML. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Format an integer amount as Indian-format rupees. */
const inr = n => CONFIG.currency + Math.round(Number(n) || 0).toLocaleString('en-IN');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const dateFmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const relTime = d => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return dateFmt(d);
};
const eta = () => { const d = new Date(Date.now() + 3 * 864e5); return dateFmt(d); };
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Star glyphs for a 0-5 rating. */
const stars = v => `<span class="stars" role="img" aria-label="${(+v).toFixed(1)} out of 5 stars"><span class="s">${'\u2605'.repeat(Math.round(v))}${'\u2606'.repeat(5 - Math.round(v))}</span></span>`;

/** Highlight the matched part of a search suggestion. */
const hl = (text, q) => {
  const t = esc(text); if (!q) return t;
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + q.length) + '</mark>' + t.slice(i + q.length);
};

const avatarOf = name => esc((name || '?').trim().charAt(0).toUpperCase());

/** RFC-4180-ish CSV serialise / parse, so admin import/export is symmetric. */
const toCsv = rows => rows.map(r =>
  r.map(v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
function fromCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ---------------------------------------------------------------------------
 * 3. DATABASE
 * A tiny document store. Each collection is a JSON array under the `se_`
 * prefix, with an in-memory fallback for private-mode browsers.
 * ------------------------------------------------------------------------- */
const mem = {};
const db = {
  key: c => 'se_' + c,
  all(c) { try { return JSON.parse(localStorage.getItem(this.key(c))) || []; } catch (e) { return mem[c] || []; } },
  save(c, a) { const v = JSON.stringify(a); try { localStorage.setItem(this.key(c), v); } catch (e) { mem[c] = a; } return a; },
  byId(c, id) { return this.all(c).find(x => x.id == id); },
  insert(c, o) {
    const a = this.all(c);
    o.id = o.id || (Math.max(0, ...a.map(x => parseInt(x.id, 10) || 0)) + 1);
    a.push(o); this.save(c, a); return o;
  },
  update(c, id, patch) {
    const a = this.all(c), i = a.findIndex(x => x.id == id);
    if (i < 0) return null;
    a[i] = { ...a[i], ...patch }; this.save(c, a); return a[i];
  },
  remove(c, id) { this.save(c, this.all(c).filter(x => x.id != id)); },
  /** Upsert keyed by an arbitrary field - used for singleton docs (carts, wishlists). */
  byKey(c, k, v) { return this.all(c).find(x => x[k] == v); },
  put(c, key, value) {
    const a = this.all(c).filter(x => x[key] !== undefined);
    const found = this.all(c).find(x => x[key] === value[key]);
    const doc = { ...(found || {}), ...value };
    const rest = this.all(c).filter(x => x[key] !== value[key]);
    this.save(c, [...rest, doc]); return doc;
  },
  clearDemo() {
    ['products', 'users', 'coupons', 'carts', 'orders', 'reviews', 'wishlist', 'recent', 'addresses'].forEach(c => this.save(c, []));
  }
};

/** Password hashing. SHA-256 where available, deterministic fallback otherwise. */
async function sha(s) {
  if (globalThis.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return 'fb' + (h >>> 0).toString(16);
}

/* ---------------------------------------------------------------------------
 * 4. SEED
 * Runs once. Creates the catalogue, two demo logins and starter reviews so
 * every screen has something to show on first visit.
 * ------------------------------------------------------------------------- */
async function seed() {
  if (db.all('products').length) return;

  // [name, emoji, category, brand, price, rating, stock, description]
  const CATALOGUE = [
    ['Wireless Earbuds', '\u{1F3A7}', 'Electronics', 'SonicWave', 2499, 4.5, 12, 'Active noise cancelling earbuds with a 24-hour battery life and low-latency mode.'],
    ['Smart Watch', '\u231A', 'Electronics', 'PulseTrack', 3999, 4.3, 8, 'Tracks steps, sleep, SpO2 and heart rate. 5ATM water resistant with a 7-day battery.'],
    ['Bluetooth Speaker', '\u{1F50A}', 'Electronics', 'SonicWave', 1799, 4.2, 14, 'Portable speaker with passive bass radiators and 12 hours of playtime.'],
    ['Mechanical Keyboard', '\u2328', 'Electronics', 'KeyForge', 5499, 4.7, 6, 'Hot-swappable 75% keyboard with tactile switches and a gasket mount.'],
    ['4K Action Camera', '\u{1F4F7}', 'Electronics', 'LumenGo', 12999, 4.6, 4, 'Shoots 4K60 with in-body stabilisation and a dual-screen body.'],
    ['Running Shoes', '\u{1F45F}', 'Fashion', 'StrideLab', 2799, 4.6, 20, 'Lightweight cushioned shoes with a breathable engineered knit upper.'],
    ['Denim Jacket', '\u{1F9E5}', 'Fashion', 'Northloom', 1899, 4.1, 15, 'Classic fit jacket in washed blue denim with a light fleece lining.'],
    ['Linen Shirt', '\u{1F455}', 'Fashion', 'Northloom', 1299, 4.2, 24, 'Relaxed-fit linen shirt that softens with every wash.'],
    ['Leather Backpack', '\u{1F392}', 'Fashion', 'Carrywell', 2299, 4.5, 25, '30L backpack with a padded laptop sleeve and hidden passport pocket.'],
    ['Yoga Mat', '\u{1F9D8}', 'Sports', 'FlowFit', 699, 4.3, 30, '6mm non-slip natural rubber mat with alignment lines.'],
    ['Cricket Bat', '\u{1F3CF}', 'Sports', 'WillowWorks', 2199, 4.7, 9, 'English willow blade, balanced for stroke play with a cane handle.'],
    ['Adjustable Dumbbells', '\u{1F3CB}', 'Sports', 'IronWorks', 7499, 4.5, 7, 'Dial-adjust dumbbells replacing 15 pairs, from 2kg to 24kg each.'],
    ['Coffee Maker', '\u2615', 'Home', 'BrewMaster', 3299, 4.4, 6, 'Brews up to 6 cups with a reusable stainless filter and a timer.'],
    ['Table Lamp', '\u{1F4A1}', 'Home', 'LumenGo', 899, 4.0, 0, 'Dimmable LED lamp with three colour temperatures and a fabric shade.'],
    ['Steel Water Bottle', '\u{1FAD6}', 'Home', 'HydraPeak', 499, 4.4, 40, 'Double-walled 1L bottle that keeps drinks cold for 24 hours.'],
    ['Air Purifier', '\u{1F32C}', 'Home', 'PureFlow', 11999, 4.6, 5, 'HEPA + carbon filter for rooms up to 40m\u00b2, with an air-quality readout.'],
    ['Notebook Set', '\u{1F4D3}', 'Stationery', 'PaperPlus', 349, 4.2, 50, 'Pack of 3 ruled notebooks, 200 pages each, with dot-grid inserts.'],
    ['Fountain Pen', '\u{1F58A}', 'Stationery', 'PaperPlus', 899, 4.6, 18, 'Steel nib fountain pen with a converter and two ink cartridges.'],
    ['Planner Notebook', '\u{1F5D3}', 'Stationery', 'PaperPlus', 599, 4.3, 22, 'Undated 12-month planner with stickers, habit and budget trackers.'],
    ['Desk Organiser', '\u{1F4DA}', 'Stationery', 'Carrywell', 749, 4.0, 16, 'Bamboo organiser with slots for pens, cables, phone and business cards.']
  ];

  CATALOGUE.forEach((p, i) => db.insert('products', {
    name: p[0], emoji: p[1], category: p[2], brand: p[3], price: p[4],
    rating: p[5], baseRating: p[5], reviewCount: 0, stock: p[6], desc: p[7],
    image: '', created: Date.now() - (CATALOGUE.length - i) * 36e5
  }));

  const admin = db.insert('users', {
    name: 'Admin', email: CONFIG.adminEmail, hash: await sha(CONFIG.adminPassword), role: 'admin', joined: Date.now()
  });
  const shopper = db.insert('users', {
    name: 'Riya Sharma', email: CONFIG.shopperEmail, hash: await sha(CONFIG.shopperPassword), role: 'user', joined: Date.now()
  });

  [['SAVE10', 'percent', 10, 500, '2030-12-31', 'Flat 10% off on orders above \u20b9500'],
   ['FLAT100', 'flat', 100, 1000, '2030-12-31', '\u20b9100 off on orders above \u20b91,000'],
   ['WELCOME20', 'percent', 20, 1500, '2030-12-31', '20% off for first-time buyers above \u20b91,500'],
   ['FREESHIP', 'flat', 99, 300, '2030-12-31', 'Waives shipping on smaller orders'],
   ['MEGA50', 'percent', 50, 5000, '2027-06-30', 'Half-price event on premium gear']
  ].forEach(c => db.insert('coupons', {
    code: c[0], type: c[1], value: c[2], min: c[3], expires: c[4], note: c[5], active: true, used: 0
  }));

  // Starter reviews so the ratings UI is not empty on a fresh install.
  const REVIEWS = [
    [1, shopper.id, shopper.name, 5, 'Battery is unreal', 'Paired instantly and lasted two full days with ANC on. Would buy again.'],
    [1, shopper.id, shopper.name, 4, 'Great, minor hiss', 'Excellent for the price. A touch of background hiss at low volume.'],
    [3, shopper.id, shopper.name, 5, 'Room filler', 'Loud enough for a small party and the bass is properly deep.'],
    [5, shopper.id, shopper.name, 5, 'Worth every rupee', ' stabilisation makes handheld footage look professional.'],
    [9, shopper.id, shopper.name, 4, 'Sleek and sturdy', 'Zips are smooth and the laptop sleeve actually fits a 16-inch.'],
    [10, shopper.id, shopper.name, 5, 'Grip is amazing', 'No slipping even in a sweaty hot-yoga class. Smells like natural rubber.'],
    [14, shopper.id, shopper.name, 4, 'Cozy light', 'Three colour temperatures is a nice touch. Dimming is smooth.'],
    [16, shopper.id, shopper.name, 5, 'Air visibly cleaner', 'The particle readout dropped from 180 to 12 within ten minutes.']
  ];
  REVIEWS.forEach((r, i) => db.insert('reviews', {
    pid: r[0], uid: r[1], name: r[2], rating: r[3], title: r[4], body: r[5],
    status: 'published', created: Date.now() - (REVIEWS.length - i) * 36e5
  }));
  recomputeRatings();
}

/** Recompute the cached average rating + count shown on product cards. */
function recomputeRatings() {
  const reviews = db.all('reviews');
  const products = db.all('products');
  for (const p of products) {
    const rs = reviews.filter(r => r.pid == p.id && r.status === 'published');
    p.reviewCount = rs.length;
    p.rating = rs.length
      ? Math.round(rs.reduce((s, r) => s + r.rating, 0) / rs.length * 10) / 10
      : (p.baseRating || 0);
  }
  db.save('products', products);
}

/* ---------------------------------------------------------------------------
 * 5. BACKEND  (simulated API surface)
 * ------------------------------------------------------------------------- */
const SECRET = 'shopease-demo-secret';
const routes = [];
const ok  = (data, status = 200) => ({ status, data });
const bad = (status, error) => ({ status, error });

const re = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^[6-9]\d{9}$/,
  pin: /^\d{6}$/,
  upi: /^[\w.-]+@[\w-]+$/,
  name: /^.{2,60}$/
};

function route(method, path, mw, handler) {
  routes.push({
    method,
    re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
    keys: (path.match(/:(\w+)/g) || []).map(k => k.slice(1)),
    mw, handler
  });
}

/** Route, authenticate, dispatch. Artificial latency keeps loading states honest. */
async function server(method, url, body, token) {
  await sleep(90 + Math.random() * 160);
  const [path, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = { ...m.groups };
    const ctx = { body: body || {}, query, params, user: null, token };
    try {
      for (const f of r.mw) { const e = await f(ctx); if (e) return e; }
      return await r.handler(ctx);
    } catch (err) {
      return bad(500, err.message || 'Unexpected server error');
    }
  }
  return bad(404, `No route for ${method} ${path}`);
}

/* --- tokens ---------------------------------------------------------------- */
async function makeToken(u) {
  const payload = btoa(JSON.stringify({ uid: u.id, role: u.role, exp: Date.now() + CONFIG.tokenTtlMs }));
  return payload + '.' + await sha(payload + SECRET);
}
async function readToken(t) {
  if (!t) return null;
  const [p, s] = t.split('.');
  if (!p || s !== await sha(p + SECRET)) return null;
  try {
    const d = JSON.parse(atob(p));
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
const optAuth = async c => { const d = await readToken(c.token); if (d) c.user = db.byId('users', d.uid); };
const auth    = async c => { await optAuth(c); return c.user ? null : bad(401, 'Please log in first'); };
const admin   = async c => { const e = await auth(c); return e || (c.user.role === 'admin' ? null : bad(403, 'Admin access only')); };
const pub     = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, joined: u.joined });

/* --- cart helpers ---------------------------------------------------------- */
const uidOf = c => (c.user ? c.user.id : 'guest');
const getCart = uid => db.byKey('carts', 'uid', uid) || { uid, items: [], coupon: null };
function saveCart(c) { db.put('carts', 'uid', c); return c; }

/**
 * Price a cart. `items` is joined to live product records so prices, stock and
 * names always reflect the current catalogue rather than what was added earlier.
 */
function totals(cart) {
  const items = cart.items
    .map(i => ({ ...i, p: db.byId('products', i.pid) }))
    .filter(i => i.p);
  const sub = items.reduce((s, i) => s + i.p.price * i.qty, 0);

  let disc = 0, couponError = null;
  const cp = cart.coupon && db.all('coupons').find(x => x.code === cart.coupon);
  if (cart.coupon) {
    if (!cp || cp.active === false) couponError = 'That coupon is no longer valid';
    else if (cp.expires < new Date().toISOString().slice(0, 10)) couponError = 'That coupon has expired';
    else if (sub < cp.min) couponError = `Spend \u20b9${cp.min.toLocaleString('en-IN')} to use ${cp.code}`;
    else disc = cp.type === 'percent' ? Math.round(sub * cp.value / 100) : Math.min(cp.value, sub);
  }
  const tax = Math.round((sub - disc) * CONFIG.taxRate);
  const ship = sub && sub - disc < CONFIG.freeShippingAbove ? CONFIG.shippingFee : 0;
  const total = sub - disc + tax + ship;
  return {
    items, sub, disc, tax, ship, total,
    coupon: disc ? cart.coupon : null,
    couponError: disc ? null : couponError,
    freeShipGap: Math.max(0, CONFIG.freeShippingAbove - (sub - disc)),
    eta: eta()
  };
}

/** Fold the anonymous cart into a real account after login / signup. */
async function mergeGuest(uid) {
  const g = getCart('guest');
  if (!g.items.length) return;
  const c = getCart(uid);
  g.items.forEach(i => {
    const x = c.items.find(y => y.pid == i.pid);
    if (x) x.qty += i.qty; else c.items.push({ ...i });
  });
  saveCart(c);
  saveCart({ uid: 'guest', items: [], coupon: null });
}

/* --- wishlist / recently viewed ------------------------------------------- */
function listDoc(coll, uid) { return db.byKey(coll, 'uid', uid) || { uid, pids: [] }; }
function saveList(coll, uid, pids) { db.put(coll, 'uid', { uid, pids }); return pids; }

/* ---------------------------------------------------------------------------
 * 6. API CLIENT
 * The single seam between UI and backend. Swapping this for `fetch` is the only
 * change needed to put a real server behind this app.
 * ------------------------------------------------------------------------- */
const api = async (method, url, body) => {
  const r = await server(method, url, body, sessionStorage.getItem('se_token'));
  if (r.status >= 400) { const e = new Error(r.error); e.status = r.status; throw e; }
  return r.data;
};

/* ===================== AUTH ================================================= */
route('POST', '/api/auth/signup', [], async c => {
  const { name = '', email = '', password = '' } = c.body;
  if (!re.name.test(name.trim())) return bad(400, 'Enter your name (2-60 characters)');
  if (!re.email.test(email)) return bad(400, 'Enter a valid email address');
  if (password.length < 6) return bad(400, 'Password must be at least 6 characters');
  const e = email.toLowerCase();
  if (db.all('users').some(u => u.email === e)) return bad(409, 'That email is already registered');
  const u = db.insert('users', { name: name.trim(), email: e, hash: await sha(password), role: 'user', joined: Date.now() });
  await mergeGuest(u.id);
  return ok({ token: await makeToken(u), user: pub(u) }, 201);
});

route('POST', '/api/auth/login', [], async c => {
  const email = (c.body.email || '').toLowerCase();
  const u = db.all('users').find(x => x.email === email);
  if (!u || u.hash !== await sha(c.body.password || '')) return bad(401, 'Wrong email or password');
  await mergeGuest(u.id);
  return ok({ token: await makeToken(u), user: pub(u) });
});

route('GET', '/api/auth/me', [auth], c => ok(pub(c.user)));

/* ===================== PRODUCTS ============================================== */
route('GET', '/api/products', [], c => {
  const { search = '', category = 'All', brand = '', min = 0, max = 0, rating = 0, inStock = 0, sort = 'new', page = 1, limit = 12 } = c.query;
  const all = db.all('products');
  const s = search.trim().toLowerCase();
  let a = all.filter(p =>
    (!s || (p.name + ' ' + p.brand + ' ' + p.category + ' ' + (p.desc || '')).toLowerCase().includes(s)) &&
    (category === 'All' || p.category === category) &&
    (!brand || p.brand === brand) &&
    (!+min || p.price >= +min) && (!+max || p.price <= +max) &&
    (+rating ? p.rating >= +rating : true) &&
    (+inStock ? p.stock > 0 : true));

  const S = {
    low: (x, y) => x.price - y.price,
    high: (x, y) => y.price - x.price,
    rating: (x, y) => y.rating - x.rating || y.reviewCount - x.reviewCount,
    reviews: (x, y) => y.reviewCount - x.reviewCount,
    name: (x, y) => x.name.localeCompare(y.name)
  };
  a = a.sort(S[sort] || S.new);

  const pages = Math.max(1, Math.ceil(a.length / +limit || 1));
  const perCat = {}; all.forEach(p => { perCat[p.category] = (perCat[p.category] || 0) + 1; });
  return ok({
    items: a.slice((+page - 1) * +limit, +page * +limit),
    total: a.length, pages, page: +page,
    categories: ['All', ...new Set(all.map(p => p.category))],
    brands: [...new Set(all.map(p => p.brand).filter(Boolean))].sort(),
    counts: perCat,
    priceBounds: { min: Math.min(0, ...all.map(p => p.price)), max: Math.max(0, ...all.map(p => p.price)) }
  });
});

route('GET', '/api/products/suggest', [], c => {
  const s = (c.query.q || '').trim().toLowerCase();
  if (!s) return ok({ suggestions: [] });
  const all = db.all('products');
  const scored = all
    .map(p => {
      const hay = `${p.name} ${p.brand} ${p.category}`.toLowerCase();
      const i = hay.indexOf(s);
      if (i < 0) return null;
      return { p, score: (p.name.toLowerCase().startsWith(s) ? 0 : 100) + i };
    })
    .filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 7);
  return ok({
    suggestions: scored.map(({ p }) => ({ id: p.id, name: p.name, brand: p.brand, price: p.price, emoji: p.emoji, stock: p.stock })),
    categories: [...new Set(all.filter(p => p.category.toLowerCase().includes(s)).map(p => p.category))].slice(0, 3)
  });
});

/* --- CSV round trip (bulk catalogue management) ----------------------------
 * Registered before /api/products/:id so the static path is not swallowed
 * by the parameterised route. The router is first-match-wins. */
route('GET', '/api/products/export.csv', [admin], () => {
  const head = ['name', 'emoji', 'category', 'brand', 'price', 'stock', 'desc'];
  const rows = db.all('products').map(p => head.map(h => p[h]));
  return ok({ filename: 'shopease-products.csv', csv: toCsv([head, ...rows]) });
});

route('POST', '/api/products/import', [admin], c => {
  const rows = fromCsv(String(c.body.csv || ''));
  if (rows.length < 2) return bad(400, 'Paste CSV with a header row plus at least one product');
  const head = rows[0].map(h => h.trim().toLowerCase());
  if (!head.includes('name') || !head.includes('price')) return bad(400, 'CSV header must include at least: name, price');
  const created = [], updated = [], errors = [];
  rows.slice(1).forEach((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()]));
    const p = prodBody(o);
    if (!p) { errors.push(`Row ${i + 2}: name and a price above 0 are required`); return; }
    const exist = db.all('products').find(x => x.name.toLowerCase() === p.name.toLowerCase());
    if (exist) { db.update('products', exist.id, p); updated.push(p.name); }
    else { p.created = Date.now(); p.reviewCount = 0; p.rating = p.baseRating; db.insert('products', p); created.push(p.name); }
  });
  return ok({ created: created.length, updated: updated.length, errors });
});

route('GET', '/api/products/:id', [], c => {
  const p = db.byId('products', c.params.id);
  if (!p) return bad(404, 'Product not found');
  const related = db.all('products')
    .filter(x => x.id != p.id && x.category === p.category)
    .sort((a, b) => b.rating - a.rating).slice(0, CONFIG.alsoLikeMax);
  return ok({
    ...p,
    related,
    inCart: getCart(uidOf(c)).items.some(i => i.pid == p.id),
    inWishlist: listDoc('wishlist', uidOf(c)).pids.some(x => x == p.id)
  });
});

const prodBody = b => {
  const p = {
    name: (b.name || '').trim(),
    emoji: (b.emoji || '\u{1F4E6}').trim(),
    category: (b.category || '').trim(),
    brand: (b.brand || '').trim(),
    price: Math.round(+b.price),
    stock: Math.max(0, Math.floor(+b.stock)),
    desc: (b.desc || '').trim(),
    image: (b.image || '').trim(),
    baseRating: +b.rating ? clamp(+b.rating, 0, 5) : 4
  };
  return p.name && p.category && p.price > 0 ? p : null;
};

route('POST', '/api/products', [admin], c => {
  const p = prodBody(c.body);
  if (!p) return bad(400, 'Name, category and a price above 0 are required');
  p.created = Date.now(); p.reviewCount = 0; p.rating = p.baseRating;
  return ok(db.insert('products', p), 201);
});

route('PUT', '/api/products/:id', [admin], c => {
  const p = prodBody(c.body);
  if (!p) return bad(400, 'Invalid product data');
  const cur = db.byId('products', c.params.id);
  if (!cur) return bad(404, 'Product not found');
  if (!cur.reviewCount) p.baseRating = p.baseRating || cur.baseRating;
  return ok(db.update('products', c.params.id, p));
});

route('DELETE', '/api/products/:id', [admin], c => {
  const p = db.byId('products', c.params.id);
  if (!p) return bad(404, 'Product not found');
  db.remove('products', p.id);
  db.save('reviews', db.all('reviews').filter(r => r.pid != p.id));
  db.all('carts').forEach(c => saveCart({ ...c, items: c.items.filter(i => i.pid != p.id) }));
  return ok({ deleted: true });
});

/* --- reviews -------------------------------------------------------------- */
route('GET', '/api/products/:id/reviews', [], c => {
  const { page = 1 } = c.query;
  const pid = c.params.id;
  const all = db.all('reviews')
    .filter(r => r.pid == pid && r.status === 'published')
    .sort((a, b) => b.created - a.created);
  const p = db.byId('products', pid);
  const dist = [5, 4, 3, 2, 1].map(star => ({ star, n: all.filter(r => r.rating === star).length }));
  const pages = Math.max(1, Math.ceil(all.length / CONFIG.reviewsPerPage));
  return ok({
    items: all.slice((+page - 1) * CONFIG.reviewsPerPage, +page * CONFIG.reviewsPerPage),
    total: all.length, pages, page: +page, dist,
    summary: { average: p ? p.rating : 0, count: all.length },
    canReview: !!c.user
  });
});

route('POST', '/api/products/:id/reviews', [auth], async c => {
  const p = db.byId('products', c.params.id);
  if (!p) return bad(404, 'Product not found');
  const rating = Math.round(+c.body.rating);
  const title = (c.body.title || '').trim();
  const body = (c.body.body || '').trim();
  if (!(rating >= 1 && rating <= 5)) return bad(400, 'Pick a star rating between 1 and 5');
  if (title.length < 3) return bad(400, 'Give your review a short headline (3+ characters)');
  if (body.length < 10) return bad(400, 'Tell us a little more (10+ characters)');
  const hasBought = db.all('orders').some(o =>
    o.uid === c.user.id && o.status !== 'Cancelled' && o.items.some(i => i.pid == p.id));
  const r = db.insert('reviews', {
    pid: p.id, uid: c.user.id, name: c.user.name, rating, title, body,
    verified: hasBought, status: 'published', created: Date.now()
  });
  recomputeRatings();
  return ok(r, 201);
});

route('DELETE', '/api/reviews/:id', [auth], c => {
  const r = db.byId('reviews', c.params.id);
  if (!r) return bad(404, 'Review not found');
  if (r.uid !== c.user.id && c.user.role !== 'admin') return bad(403, 'You can only delete your own review');
  db.remove('reviews', r.id);
  recomputeRatings();
  return ok({ deleted: true });
});

/* ===================== WISHLIST + RECENTLY VIEWED ========================== */
route('GET', '/api/wishlist', [optAuth], c => {
  const ids = listDoc('wishlist', uidOf(c)).pids;
  const items = ids.map(id => db.byId('products', id)).filter(Boolean);
  return ok({ items, total: items.length });
});

route('POST', '/api/wishlist', [optAuth], c => {
  const p = db.byId('products', c.body.productId);
  if (!p) return bad(404, 'Product not found');
  const d = listDoc('wishlist', uidOf(c));
  if (!d.pids.some(x => x == p.id)) d.pids.unshift(p.id);
  saveList('wishlist', uidOf(c), d.pids);
  return ok({ items: d.pids.length, added: true });
});

route('DELETE', '/api/wishlist/:pid', [optAuth], c => {
  const d = listDoc('wishlist', uidOf(c));
  saveList('wishlist', uidOf(c), d.pids.filter(x => x != c.params.pid));
  return ok({ items: d.pids.filter(x => x != c.params.pid).length });
});

route('POST', '/api/wishlist/:pid/move-to-cart', [optAuth], async c => {
  const p = db.byId('products', c.params.pid);
  if (!p) return bad(404, 'Product not found');
  if (p.stock < 1) return bad(400, `${p.name} is out of stock`);
  const cart = getCart(uidOf(c));
  const it = cart.items.find(i => i.pid == p.id);
  const cap = Math.min(p.stock, CONFIG.maxQtyPerItem);
  if ((it ? it.qty : 0) + 1 > cap) return bad(400, `Only ${cap} allowed per order`);
  it ? it.qty++ : cart.items.push({ pid: p.id, qty: 1 });
  saveCart(cart);
  saveList('wishlist', uidOf(c), listDoc('wishlist', uidOf(c)).pids.filter(x => x != p.id));
  return ok({ cart: totals(cart) });
});

route('GET', '/api/recent', [optAuth], c => {
  const ids = listDoc('recent', uidOf(c)).pids.slice(0, CONFIG.recentMax);
  return ok({ items: ids.map(id => db.byId('products', id)).filter(Boolean) });
});

route('POST', '/api/recent', [optAuth], c => {
  const p = db.byId('products', c.body.productId);
  if (!p) return bad(404, 'Product not found');
  const d = listDoc('recent', uidOf(c));
  saveList('recent', uidOf(c), [p.id, ...d.pids.filter(x => x != p.id)].slice(0, CONFIG.recentMax));
  return ok({ logged: true });
});

/* ===================== CART ================================================= */
route('GET', '/api/cart', [optAuth], c => ok(totals(getCart(uidOf(c)))));

route('POST', '/api/cart', [optAuth], c => {
  const p = db.byId('products', c.body.productId);
  const n = Math.max(1, Math.floor(+c.body.qty || 1));
  if (!p) return bad(404, 'Product not found');
  if (p.stock < 1) return bad(400, `${p.name} is out of stock`);
  const cart = getCart(uidOf(c));
  const it = cart.items.find(i => i.pid == p.id);
  const cap = Math.min(p.stock, CONFIG.maxQtyPerItem);
  if ((it ? it.qty : 0) + n > cap) return bad(400, `Only ${cap} of ${p.name} allowed per order`);
  it ? it.qty += n : cart.items.push({ pid: p.id, qty: n });
  saveCart(cart);
  return ok(totals(cart), 201);
});

/* Registered before /api/cart/:pid so the literal path wins the match. */
route('DELETE', '/api/cart/coupon', [optAuth], c => ok(totals(saveCart({ ...getCart(uidOf(c)), coupon: null }))));

route('PUT', '/api/cart/:pid', [optAuth], c => {
  const cart = getCart(uidOf(c));
  const it = cart.items.find(i => i.pid == c.params.pid);
  const p = db.byId('products', c.params.pid);
  const n = Math.floor(+c.body.qty);
  if (!it) return bad(404, 'That item is not in your cart');
  if (!p) return bad(404, 'Product no longer exists');
  if (n < 1) return bad(400, 'Quantity must be at least 1');
  if (n > Math.min(p.stock, CONFIG.maxQtyPerItem)) return bad(400, `Quantity must be between 1 and ${Math.min(p.stock, CONFIG.maxQtyPerItem)}`);
  it.qty = n; saveCart(cart);
  return ok(totals(cart));
});

route('DELETE', '/api/cart/:pid', [optAuth], c => {
  const cart = getCart(uidOf(c));
  const gone = cart.items.find(i => i.pid == c.params.pid);
  cart.items = cart.items.filter(i => i.pid != c.params.pid);
  saveCart(cart);
  return ok({ ...totals(cart), removed: gone ? { ...gone } : null });
});

route('GET', '/api/coupons', [], c => {
  const today = new Date().toISOString().slice(0, 10);
  return ok(db.all('coupons').filter(x => x.active !== false && x.expires >= today));
});

route('POST', '/api/coupons/apply', [optAuth], c => {
  const code = (c.body.code || '').toUpperCase().trim();
  const cp = db.all('coupons').find(x => x.code === code);
  const cart = getCart(uidOf(c));
  if (!cp || cp.active === false) return bad(400, 'That coupon code does not exist');
  if (cp.expires < new Date().toISOString().slice(0, 10)) return bad(400, `${code} expired on ${dateFmt(cp.expires)}`);
  const t = totals(cart);
  if (t.sub < cp.min) return bad(400, `Add ${inr(cp.min - t.sub)} more to use ${code} (minimum ${inr(cp.min)})`);
  return ok(totals(saveCart({ ...cart, coupon: code })));
});

/* ===================== ADDRESS BOOK ======================================== */
const adrBody = b => {
  const a = {
    label: (b.label || 'Home').trim().slice(0, 24),
    name: (b.name || '').trim(),
    phone: (b.phone || '').replace(/\D/g, ''),
    pin: (b.pin || '').replace(/\D/g, ''),
    address: (b.address || '').trim(),
    city: (b.city || '').trim(),
    isDefault: !!b.isDefault
  };
  if (!re.name.test(a.name)) return { err: 'Enter the recipient name' };
  if (!re.phone.test(a.phone)) return { err: 'Phone must be 10 digits starting with 6-9' };
  if (!re.pin.test(a.pin)) return { err: 'PIN code must be 6 digits' };
  if (a.address.length < 8) return { err: 'Enter the full street address' };
  return { a };
};

route('GET', '/api/addresses', [auth], c =>
  ok(db.all('addresses').filter(a => a.uid == c.user.id).sort((x, y) => y.isDefault - x.isDefault)));

route('POST', '/api/addresses', [auth], c => {
  const { a, err } = adrBody(c.body);
  if (err) return bad(400, err);
  const mine = db.all('addresses').filter(x => x.uid == c.user.id);
  a.uid = c.user.id;
  if (a.isDefault || !mine.length) a.isDefault = true;
  if (a.isDefault) db.all('addresses').filter(x => x.uid == c.user.id).forEach(x => db.update('addresses', x.id, { isDefault: false }));
  return ok(db.insert('addresses', a), 201);
});

route('PUT', '/api/addresses/:id', [auth], c => {
  const cur = db.byId('addresses', c.params.id);
  if (!cur || cur.uid != c.user.id) return bad(404, 'Address not found');
  const { a, err } = adrBody({ ...cur, ...c.body });
  if (err) return bad(400, err);
  if (a.isDefault) db.all('addresses').filter(x => x.uid == c.user.id && x.id != cur.id).forEach(x => db.update('addresses', x.id, { isDefault: false }));
  return ok(db.update('addresses', cur.id, { ...a, uid: c.user.id }));
});

route('DELETE', '/api/addresses/:id', [auth], c => {
  const cur = db.byId('addresses', c.params.id);
  if (!cur || cur.uid != c.user.id) return bad(404, 'Address not found');
  db.remove('addresses', cur.id);
  if (cur.isDefault) {
    const rest = db.all('addresses').filter(x => x.uid == c.user.id);
    if (rest.length) db.update('addresses', rest[0].id, { isDefault: true });
  }
  return ok({ deleted: true });
});

/* ===================== ORDERS =============================================== */
const STATUSES = ['Placed', 'Packed', 'Shipped', 'Delivered'];

route('POST', '/api/orders', [auth], c => {
  const { shipping: s = {}, payment: pay = {} } = c.body;
  const cart = getCart(c.user.id);
  const t = totals(cart);
  if (!t.items.length) return bad(400, 'Your cart is empty');

  const { a, err } = adrBody(s);
  if (err) return bad(400, err);
  if (!re.email.test(s.email || '')) return bad(400, 'Enter a valid email for order updates');
  if (!['cod', 'card', 'upi'].includes(pay.method)) return bad(400, 'Choose a payment method');
  if (pay.method === 'card' && !/^\d{16}$/.test(String(pay.card || '').replace(/\s/g, ''))) return bad(400, 'Card number must be 16 digits');
  if (pay.method === 'upi' && !re.upi.test(pay.upi || '')) return bad(400, 'Enter a valid UPI ID like name@bank');

  for (const i of t.items) if (i.p.stock < i.qty) return bad(409, `${i.p.name} has only ${i.p.stock} left in stock`);

  t.items.forEach(i => db.update('products', i.p.id, { stock: i.p.stock - i.qty }));
  if (t.coupon) {
    const cp = db.byId('coupons', t.coupon);
    if (cp) db.update('coupons', cp.id, { used: (cp.used || 0) + 1 });
  }

  const d = new Date();
  const seq = String(db.all('orders').length + 1).padStart(3, '0');
  const id = 'SE-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '-' + seq;
  const o = db.insert('orders', {
    id, uid: c.user.id, user: c.user.name, email: s.email,
    date: d.toISOString(), status: 'Placed',
    history: [{ status: 'Placed', at: d.toISOString(), note: 'Payment method: ' + pay.method.toUpperCase() }],
    shipping: { ...a, email: s.email },
    payment: { method: pay.method, last4: pay.method === 'card' ? String(pay.card || '').replace(/\D/g, '').slice(-4) : null, upi: pay.method === 'upi' ? pay.upi : null },
    items: t.items.map(i => ({ pid: i.p.id, name: i.p.name, emoji: i.p.emoji, price: i.p.price, qty: i.qty })),
    sub: t.sub, disc: t.disc, tax: t.tax, ship: t.ship, total: t.total, coupon: t.coupon
  });

  saveCart({ uid: c.user.id, items: [], coupon: null });
  return ok(o, 201);
});

route('GET', '/api/orders', [auth], c =>
  ok(db.all('orders').filter(o => o.uid == c.user.id).sort((a, b) => b.date.localeCompare(a.date))));

route('GET', '/api/orders/:id', [auth], c => {
  const o = db.byId('orders', c.params.id);
  if (!o || (o.uid != c.user.id && c.user.role !== 'admin')) return bad(404, 'Order not found');
  return ok(o);
});

route('PUT', '/api/orders/:id/cancel', [auth], c => {
  const o = db.byId('orders', c.params.id);
  if (!o || o.uid != c.user.id) return bad(404, 'Order not found');
  if (!['Placed', 'Packed'].includes(o.status)) return bad(400, 'Shipped orders can no longer be cancelled');
  o.items.forEach(i => {
    const p = db.byId('products', i.pid);
    if (p) db.update('products', p.id, { stock: p.stock + i.qty });
  });
  return ok(db.update('orders', o.id, {
    status: 'Cancelled',
    history: [...(o.history || []), { status: 'Cancelled', at: new Date().toISOString(), note: 'Cancelled by customer' }]
  }));
});

/* ===================== ADMIN ================================================ */
route('GET', '/api/admin/orders', [admin], () => ok(db.all('orders').sort((a, b) => b.date.localeCompare(a.date))));

route('PUT', '/api/admin/orders/:id/status', [admin], c => {
  const o = db.byId('orders', c.params.id);
  if (!o) return bad(404, 'Order not found');
  if (![...STATUSES, 'Cancelled'].includes(c.body.status)) return bad(400, 'Invalid status');
  return ok(db.update('orders', o.id, {
    status: c.body.status,
    history: [...(o.history || []), { status: c.body.status, at: new Date().toISOString(), note: 'Updated by admin' }]
  }));
});

route('GET', '/api/admin/dashboard', [admin], () => {
  const orders = db.all('orders');
  const paid = orders.filter(o => o.status !== 'Cancelled');
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const by = {};
  orders.forEach(o => { by[o.status] = (by[o.status] || 0) + 1; });

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = d.toISOString().slice(0, 10);
    const dayOrders = paid.filter(o => o.date.slice(0, 10) === key);
    days.push({
      date: key,
      label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      orders: dayOrders.length,
      revenue: dayOrders.reduce((s, o) => s + o.total, 0)
    });
  }

  const products = db.all('products');
  const sold = {};
  paid.forEach(o => o.items.forEach(i => { sold[i.pid] = (sold[i.pid] || 0) + i.qty; }));
  const topProducts = Object.entries(sold)
    .map(([pid, units]) => ({ ...(db.byId('products', pid) || { name: 'Deleted product', emoji: 'â“' }), units }))
    .sort((a, b) => b.units - a.units).slice(0, 5);

  const allRatings = paid.flatMap(o => o.items.map(i => i.price));
  return ok({
    revenue,
    orders: orders.length,
    paidOrders: paid.length,
    users: db.all('users').length,
    products: products.length,
    aov: paid.length ? Math.round(revenue / paid.length) : 0,
    pendingReviews: db.all('reviews').filter(r => r.status === 'hidden').length,
    by,
    days,
    topProducts,
    lowStock: products.filter(p => p.stock > 0 && p.stock <= CONFIG.lowStockAt)
      .sort((a, b) => a.stock - b.stock),
    outOfStock: products.filter(p => p.stock === 0),
    catalogueValue: products.reduce((s, p) => s + p.price * p.stock, 0),
    recentOrders: orders.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    avgOrderValue: allRatings.length ? Math.round(revenue / paid.length) : 0
  });
});

route('GET', '/api/admin/coupons', [admin], () => ok(db.all('coupons')));
route('GET', '/api/admin/reviews', [admin], () =>
  ok(db.all('reviews').sort((a, b) => b.created - a.created).map(r => ({ ...r, product: db.byId('products', r.pid) }))));

route('POST', '/api/admin/coupons', [admin], c => {
  const body = c.body;
  const code = (body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (code.length < 3) return bad(400, 'Code must be 3-12 letters or digits');
  if (db.all('coupons').some(x => x.code === code)) return bad(409, 'That code already exists');
  if (!['percent', 'flat'].includes(body.type)) return bad(400, 'Type must be percent or flat');
  const value = +body.value;
  if (!(value > 0)) return bad(400, 'Discount value must be above 0');
  if (body.type === 'percent' && value > 90) return bad(400, 'Percentage discount cannot exceed 90%');
  if (!body.expires) return bad(400, 'Pick an expiry date');
  return ok(db.insert('coupons', {
    code, type: body.type, value, min: Math.max(0, +body.min || 0),
    expires: body.expires, note: (body.note || '').trim(), active: true, used: 0
  }), 201);
});

route('PUT', '/api/admin/coupons/:id', [admin], c => {
  const cp = db.byId('coupons', c.params.id);
  if (!cp) return bad(404, 'Coupon not found');
  const patch = {};
  if (c.body.active !== undefined) patch.active = !!c.body.active;
  if (c.body.expires) patch.expires = c.body.expires;
  if (c.body.min !== undefined) patch.min = Math.max(0, +c.body.min || 0);
  if (c.body.note !== undefined) patch.note = c.body.note.trim();
  return ok(db.update('coupons', cp.id, patch));
});

route('DELETE', '/api/admin/coupons/:id', [admin], c => {
  const cp = db.byId('coupons', c.params.id);
  if (!cp) return bad(404, 'Coupon not found');
  db.remove('coupons', cp.id);
  db.all('carts').forEach(x => { if (x.coupon === cp.code) saveCart({ ...x, coupon: null }); });
  return ok({ deleted: true });
});



export { CONFIG, db, seed, server, api, totals, getCart, recomputeRatings, sha, makeToken, readToken, STATUSES };
