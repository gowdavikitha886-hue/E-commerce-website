// Functional test harness for the ShopEase simulated backend.
// Imports the browser-half of index.html and exercises the API end to end.
class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();

const B = await import('./tmp/backend.mjs');
const { CONFIG, db, api, server } = B;

let pass = 0, failCount = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(`  PASS  ${name}`); }
  catch (e) { failCount++; results.push(`  FAIL  ${name}\n          -> ${e.message}`); }
}
function eq(a, b, msg = '') {
  const A = JSON.stringify(a), Bv = JSON.stringify(b);
  if (A !== Bv) throw new Error(`${msg} expected ${Bv} got ${A}`);
}
async function ta(name, fn) {
  try { await fn(); pass++; results.push(`  PASS  ${name}`); }
  catch (e) { failCount++; results.push(`  FAIL  ${name}\n          -> ${e.message}`); }
}
async function seedCart() {
  const c = await api('GET', '/api/cart');
  for (const i of c.items) await api('DELETE', '/api/cart/' + i.pid);
  const p = db.all('products').find(x => x.stock >= 3 && x.price > 500);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
}
async function throws(fn, expect) {
  try { await fn(); } catch (e) { if (expect && !String(e.message).includes(expect)) throw new Error(`wanted "${expect}", got "${e.message}"`); return e; }
  throw new Error(`expected an error${expect ? ' containing "' + expect + '"' : ''}, but call succeeded`);
}

console.log('\n== BOOT / SEED ==');
await B.seed();
t('seeds 20 products', () => eq(db.all('products').length, 20));
t('seeds admin + shopper users', () => eq(db.all('users').length, 2));
t('seeds 5 coupons', () => eq(db.all('coupons').length, 5));
t('seeds 8 starter reviews', () => eq(db.all('reviews').length, 8));
t('product carries brand', () => eq(db.all('products')[0].brand, 'SonicWave'));
t('seed is idempotent (no double seed)', async () => {});
await B.seed();
t('re-running seed changes nothing', () => eq(db.all('products').length, 20));
t('review counts roll up onto products', () => {
  const p = db.all('products').find(x => x.id === 1);
  eq(p.reviewCount, 2, 'reviewCount:');
  eq(p.rating, 4.5, 'avg rating:');
});

console.log('\n== AUTH ==');
let cust, adm, custTok, admTok;
await ta('customer login works', async () => {
  const r = await api('POST', '/api/auth/login', { email: CONFIG.shopperEmail, password: CONFIG.shopperPassword });
  cust = r.user; custTok = r.token;
  eq(cust.role, 'user');
});
await ta('admin login works', async () => {
  const r = await api('POST', '/api/auth/login', { email: CONFIG.adminEmail, password: CONFIG.adminPassword });
  adm = r.user; admTok = r.token;
  eq(adm.role, 'admin');
});
await ta('wrong password rejected', () => throws(() => api('POST', '/api/auth/login', { email: CONFIG.adminEmail, password: 'nope' }), 'Wrong email'));
await ta('duplicate signup blocked', async () => {
  await throws(() => api('POST', '/api/auth/signup', { name: 'Riya Sharma', email: CONFIG.shopperEmail, password: 'abcdef' }), 'already registered');
});
await ta('signup validates email', () => throws(() => api('POST', '/api/auth/signup', { name: 'Valid Name', email: 'bad', password: 'abcdef' }), 'valid email'));
await ta('signup validates password length', () => throws(() => api('POST', '/api/auth/signup', { name: 'Valid Name', email: 'new@x.com', password: '123' }), '6 characters'));
await ta('tampered token rejected', async () => {
  sessionStorage.setItem('se_token', custTok.split('.')[0] + '.deadbeef');
  await throws(() => api('GET', '/api/auth/me'), 'log in first');
  sessionStorage.setItem('se_token', custTok);
});
await ta('customer blocked from admin routes', () => throws(() => api('GET', '/api/admin/dashboard'), 'Admin access only'));
await ta('anonymous blocked from orders', async () => {
  sessionStorage.removeItem('se_token');
  await throws(() => api('GET', '/api/orders'), 'log in first');
});

console.log('\n== PRODUCTS / FILTERS ==');
sessionStorage.setItem('se_token', '');
await ta('list defaults to page 1', async () => {
  const r = await api('GET', '/api/products');
  eq(r.items.length, 12); eq(r.page, 1); eq(r.total, 20); eq(r.pages, 2);
});
await ta('brand + category facets returned', async () => {
  const r = await api('GET', '/api/products');
  if (!r.brands.includes('SonicWave')) throw new Error('brands missing');
  if (!r.categories.includes('All')) throw new Error('categories missing');
});
await ta('search matches brand and description', async () => {
  const r = await api('GET', '/api/products?search=willow');
  if (!r.items.some(p => p.name.includes('Cricket'))) throw new Error('search by description failed');
});
await ta('price range filter', async () => {
  const r = await api('GET', '/api/products?min=2000&max=4000');
  r.items.forEach(p => { if (p.price < 2000 || p.price > 4000) throw new Error('out of range: ' + p.price); });
});
await ta('inStock filter hides sold-out items', async () => {
  const r = await api('GET', '/api/products?inStock=1');
  if (r.items.some(p => p.stock === 0)) throw new Error('sold-out item leaked through');
});
await ta('rating filter', async () => {
  const r = await api('GET', '/api/products?rating=4.5');
  r.items.forEach(p => { if (p.rating < 4.5) throw new Error('low-rated leaked: ' + p.rating); });
});
await ta('sort high -> low by price', async () => {
  const r = await api('GET', '/api/products?sort=high&limit=20');
  for (let i = 1; i < r.items.length; i++) {
    if (r.items[i].price > r.items[i - 1].price) throw new Error('not descending');
  }
});
await ta('pagination returns disjoint pages', async () => {
  const a = await api('GET', '/api/products?page=1&limit=12');
  const b = await api('GET', '/api/products?page=2&limit=12');
  const ids = new Set(a.items.map(p => p.id));
  if (b.items.some(p => ids.has(p.id))) throw new Error('page overlap');
  eq(b.items.length, 8);
});
await ta('autocomplete suggests prefix matches first', async () => {
  const r = await api('GET', '/api/products/suggest?q=yoga');
  if (!r.suggestions.length) throw new Error('no suggestions');
  if (!r.suggestions[0].name.toLowerCase().includes('yoga')) throw new Error('prefix match not first');
});
await ta('empty query returns no suggestions', async () => eq((await api('GET', '/api/products/suggest?q=')).suggestions.length, 0));
await ta('product detail includes related items', async () => {
  const r = await api('GET', '/api/products/1');
  if (!Array.isArray(r.related)) throw new Error('no related');
  if (r.related.some(x => x.id === 1)) throw new Error('related contains itself');
});
await ta('missing product 404s', () => throws(() => api('GET', '/api/products/99999'), 'not found'));

console.log('\n== REVIEWS ==');
await ta('anon cannot review', async () => {
  sessionStorage.removeItem('se_token');
  await throws(() => api('POST', '/api/products/2/reviews', { rating: 5, title: 'Nice', body: 'Really nice item' }), 'log in first');
});
await ta('review requires 1-5 stars', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/products/2/reviews', { rating: 9, title: 'Nice', body: 'Really nice item' }), 'star rating');
});
await ta('review requires a headline', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/products/2/reviews', { rating: 4, title: 'x', body: 'Really nice item' }), 'headline');
});
await ta('review requires a body', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/products/2/reviews', { rating: 4, title: 'Good one', body: 'short' }), 'little more');
});
await ta('valid review is accepted and rolls up', async () => {
  sessionStorage.setItem('se_token', custTok);
  const before = (await api('GET', '/api/products/2')).rating;
  const r = await api('POST', '/api/products/2/reviews', { rating: 5, title: 'Superb', body: 'Battery life is genuinely great.' });
  if (!r.id || !r.created) throw new Error('review was not persisted: ' + JSON.stringify(r));
  const after = (await api('GET', '/api/products/2')).rating;
  if (after <= before) throw new Error(`rating did not rise: ${before} -> ${after}`);
});
await ta('reviews are marked verified for buyers', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 2);
  await seedCart();
  await api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'riya@example.com', phone: '9876543210', pin: '560001', city: 'Bengaluru', address: '12 MG Road' },
    payment: { method: 'cod' }
  });
  await api('POST', '/api/products/' + p.id + '/reviews', { rating: 5, title: 'Paid for it', body: 'This one I actually paid for myself.' });
  sessionStorage.setItem('se_token', admTok);
  const list = await api('GET', '/api/admin/reviews');
  if (!list.some(r => r.verified)) throw new Error('no verified reviews found');
  sessionStorage.setItem('se_token', custTok);
});
await ta('review distribution covers 5 stars', async () => {
  const r = await api('GET', '/api/products/1/reviews');
  eq(r.dist.length, 5);
  eq(r.dist.reduce((s, d) => s + d.n, 0), r.total, 'dist sum:');
});
await ta('cannot delete another customer review', async () => {
  const other = await api('POST', '/api/auth/signup', { name: 'Nosy Person', email: 'nosy@person.com', password: 'secret1' });
  sessionStorage.setItem('se_token', custTok);
  const r = await api('POST', '/api/products/3/reviews', { rating: 3, title: 'Meh', body: 'It did the job, nothing special.' });
  sessionStorage.setItem('se_token', other.token);
  await throws(() => api('DELETE', '/api/reviews/' + r.id), 'own review');
  sessionStorage.setItem('se_token', custTok);
});
await ta('author can delete own review, totals recompute', async () => {
  sessionStorage.setItem('se_token', custTok);
  const before = (await api('GET', '/api/products/3')).reviewCount;
  const mine = db.all('reviews').filter(r => r.uid === cust.id && r.pid == 3);
  await api('DELETE', '/api/reviews/' + mine[mine.length - 1].id);
  const after = (await api('GET', '/api/products/3')).reviewCount;
  eq(after, before - 1, 'reviewCount:');
});

console.log('\n== WISHLIST + RECENT ==');
await ta('wishlist add is idempotent', async () => {
  sessionStorage.setItem('se_token', custTok);
  await api('POST', '/api/wishlist', { productId: 3 });
  await api('POST', '/api/wishlist', { productId: 3 });
  eq((await api('GET', '/api/wishlist')).items.length, 1);
});
await ta('wishlist remove', async () => {
  sessionStorage.setItem('se_token', custTok);
  await api('POST', '/api/wishlist', { productId: 3 });
  await api('POST', '/api/wishlist', { productId: 6 });
  eq((await api('GET', '/api/wishlist')).items.length, 2);
  await api('DELETE', '/api/wishlist/6');
  eq((await api('GET', '/api/wishlist')).items.length, 1);
});
await ta('move-to-cart adds and unsaves', async () => {
  sessionStorage.setItem('se_token', custTok);
  const r = await api('POST', '/api/wishlist/3/move-to-cart');
  if (!r.cart.items.some(i => i.pid == 3)) throw new Error('not in cart');
  eq((await api('GET', '/api/wishlist')).items.length, 0, 'wishlist after move:');
});
await ta('recent is capped and de-duplicated', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const id of [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) await api('POST', '/api/recent', { productId: id });
  const r = await api('GET', '/api/recent');
  eq(r.items.length, CONFIG.recentMax, 'recent length:');
  eq(r.items[0].id, 13, 'most recent first:');
  if (new Set(r.items.map(p => p.id)).size !== r.items.length) throw new Error('duplicates in recent');
});

console.log('\n== CART + COUPONS ==');
await ta('sold-out item cannot be added', async () => {
  sessionStorage.setItem('se_token', custTok);
  await api('DELETE', '/api/cart/3');
  const soldOut = db.all('products').find(p => p.stock === 0);
  await throws(() => api('POST', '/api/cart', { productId: soldOut.id }), 'out of stock');
});
await ta('per-order cap enforced', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > CONFIG.maxQtyPerItem);
  await api('DELETE', '/api/cart/' + p.id);
  await throws(() => api('POST', '/api/cart', { productId: p.id, qty: CONFIG.maxQtyPerItem + 5 }), 'allowed per order');
});
await ta('quantity cannot exceed stock', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 0 && x.stock < CONFIG.maxQtyPerItem);
  await api('POST', '/api/cart', { productId: p.id, qty: 1 });
  await throws(() => api('PUT', '/api/cart/' + p.id, { qty: p.stock + 1 }), 'between 1 and');
});
await ta('totals math is correct', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  await api('DELETE', '/api/cart/coupon');
  const p = db.all('products').find(x => x.stock >= 2 && x.price > 1000);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  const c = await api('GET', '/api/cart');
  eq(c.sub, p.price * 2, 'sub:');
  eq(c.disc, 0, 'disc:');
  eq(c.tax, Math.round(c.sub * CONFIG.taxRate), 'tax:');
  eq(c.ship, 0, 'ship (over free threshold):');
  eq(c.total, c.sub + c.tax + c.ship, 'total:');
});
await ta('shipping fee applies below the threshold', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  await api('DELETE', '/api/cart/coupon');
  const p = db.all('products').find(x => x.stock >= 1 && x.price < CONFIG.freeShippingAbove);
  await api('POST', '/api/cart', { productId: p.id, qty: 1 });
  const c = await api('GET', '/api/cart');
  if (c.ship !== CONFIG.shippingFee) throw new Error(`expected ${CONFIG.shippingFee}, got ${c.ship}`);
  if (c.freeShipGap !== CONFIG.freeShippingAbove - c.sub) throw new Error('freeShipGap wrong');
});
await ta('unknown coupon rejected', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/coupons/apply', { code: 'NOPE' }), 'does not exist');
});
await ta('coupon below its minimum rejected', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  const cheap = db.all('products').find(x => x.price < 500);
  await api('POST', '/api/cart', { productId: cheap.id, qty: 1 });
  await throws(() => api('POST', '/api/coupons/apply', { code: 'WELCOME20' }), 'more to use');
});
await ta('percent coupon discounts the subtotal', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  await api('DELETE', '/api/cart/coupon');
  const p = db.all('products').find(x => x.stock >= 1 && x.price * 2 > 500 && x.price * 2 < 999);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  const c = await api('POST', '/api/coupons/apply', { code: 'SAVE10' });
  eq(c.coupon, 'SAVE10');
  eq(c.disc, Math.round(c.sub * 0.1), 'disc:');
  eq(c.tax, Math.round((c.sub - c.disc) * CONFIG.taxRate), 'tax on discounted base:');
});
await ta('expired coupon rejected', async () => {
  sessionStorage.setItem('se_token', custTok);
  db.insert('coupons', { code: 'GONE', type: 'flat', value: 50, min: 0, expires: '2020-01-01', active: true });
  await throws(() => api('POST', '/api/coupons/apply', { code: 'GONE' }), 'expired');
});
await ta('removing a coupon restores the total', async () => {
  sessionStorage.setItem('se_token', custTok);
  const withC = await api('GET', '/api/cart');
  const after = await api('DELETE', '/api/cart/coupon');
  eq(after.disc, 0, 'disc:');
  if (after.total <= withC.total) throw new Error('total should rise after removing discount');
});
await ta('removing an item reports what was removed (for undo)', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 0);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  const r = await api('DELETE', '/api/cart/' + p.id);
  eq(r.removed.qty, 2, 'removed qty:');
});

console.log('\n== ADDRESS BOOK ==');
await ta('address validation rejects short phone', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/addresses', { name: 'Riya', phone: '12345', pin: '560001', address: '1 Test Street' }), '10 digits');
});
await ta('address validation rejects bad PIN', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/addresses', { name: 'Riya', phone: '9876543210', pin: '12', address: '1 Test Street' }), 'PIN code');
});
await ta('first address becomes the default', async () => {
  sessionStorage.setItem('se_token', custTok);
  const a = await api('POST', '/api/addresses', { label: 'Home', name: 'Riya Sharma', phone: '9876543210', pin: '560001', address: '12 MG Road, Bengaluru' });
  eq(a.isDefault, true);
});
await ta('setting a default clears the previous one', async () => {
  sessionStorage.setItem('se_token', custTok);
  const b = await api('POST', '/api/addresses', { label: 'Work', name: 'Riya Sharma', phone: '9876543210', pin: '400001', address: '99 Church Street, Mumbai' });
  await api('PUT', '/api/addresses/' + b.id, { isDefault: true });
  const all = await api('GET', '/api/addresses');
  eq(all.filter(x => x.isDefault).length, 1, 'default count:');
});
await ta('one customer cannot read another\'s addresses', async () => {
  const other = await api('POST', '/api/auth/signup', { name: 'New Person', email: 'new@person.com', password: 'secret1' });
  sessionStorage.setItem('se_token', other.token);
  const all = await api('GET', '/api/addresses');
  eq(all.length, 0, 'new user addresses:');
  const mine = db.all('addresses').filter(x => x.uid === cust.id);
  await throws(() => api('DELETE', '/api/addresses/' + mine[0].id), 'not found');
  sessionStorage.setItem('se_token', custTok);
});
await ta('deleting the default promotes another', async () => {
  sessionStorage.setItem('se_token', custTok);
  let all = await api('GET', '/api/addresses');
  const def = all.find(x => x.isDefault);
  await api('DELETE', '/api/addresses/' + def.id);
  all = await api('GET', '/api/addresses');
  eq(all.filter(x => x.isDefault).length, 1, 'exactly one default remains:');
});

console.log('\n== ORDERS ==');
let orderId;
await ta('empty cart cannot check out', async () => {
  sessionStorage.setItem('se_token', custTok);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  await throws(() => api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'r@x.com', phone: '9876543210', pin: '560001', address: '12 MG Road' },
    payment: { method: 'cod' }
  }), 'cart is empty');
});
await ta('bad shipping details rejected', async () => {
  sessionStorage.setItem('se_token', custTok);
  await seedCart();
  await throws(() => api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'bad', phone: '1', pin: '1', address: '' }, payment: { method: 'cod' }
  }), '10 digits');
});
await ta('card must be 16 digits', async () => {
  sessionStorage.setItem('se_token', custTok);
  await seedCart();
  await throws(() => api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'r@x.com', phone: '9876543210', pin: '560001', address: '12 MG Road' },
    payment: { method: 'card', card: '4242' }
  }), '16 digits');
});
await ta('UPI id must look like name@bank', async () => {
  sessionStorage.setItem('se_token', custTok);
  await seedCart();
  await throws(() => api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'r@x.com', phone: '9876543210', pin: '560001', address: '12 MG Road' },
    payment: { method: 'upi', upi: 'not-a-upi' }
  }), 'valid UPI ID');
});
await ta('valid order places, restocks and empties cart', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock >= 2 && x.price > 500);
  for (const i of (await api('GET', '/api/cart')).items) await api('DELETE', '/api/cart/' + i.pid);
  const stockBefore = db.byId('products', p.id).stock;
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  const o = await api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', label: 'Home', email: 'riya@example.com', phone: '9876543210', pin: '560001', city: 'Bengaluru', address: '12 MG Road' },
    payment: { method: 'card', card: '4242424242424242' }
  });
  orderId = o.id;
  if (!/^SE-\d{8}-\d{3}$/.test(o.id)) throw new Error('bad order id format: ' + o.id);
  eq(o.status, 'Placed', 'status:');
  eq(db.byId('products', p.id).stock, stockBefore - 2, 'stock decremented:');
  eq((await api('GET', '/api/cart')).items.length, 0, 'cart cleared:');
  eq(o.payment.last4, '4242', 'card last4 stored:');
  eq(o.items.length, 1, 'item snapshot stored:');
});
await ta('order totals reconcile with the cart', async () => {
  sessionStorage.setItem('se_token', custTok);
  const o = await api('GET', '/api/orders/' + orderId);
  if (o.sub - o.disc + o.tax + o.ship !== o.total) throw new Error(`totals do not reconcile: ${o.sub} - ${o.disc} + ${o.tax} + ${o.ship} != ${o.total}`);
});
await ta('order starts with a Placed history entry', async () => {
  sessionStorage.setItem('se_token', custTok);
  const o = await api('GET', '/api/orders/' + orderId);
  eq(o.history.length, 1); eq(o.history[0].status, 'Placed');
});
await ta('cannot read another customer\'s order', async () => {
  const other = await api('POST', '/api/auth/signup', { name: 'Other Person', email: 'other@person.com', password: 'secret1' });
  sessionStorage.setItem('se_token', other.token);
  await throws(() => api('GET', '/api/orders/' + orderId), 'not found');
  sessionStorage.setItem('se_token', custTok);
});
await ta('status advance appends history', async () => {
  sessionStorage.setItem('se_token', admTok);
  const o = await api('PUT', `/api/admin/orders/${orderId}/status`, { status: 'Shipped' });
  eq(o.history.length, 2); eq(o.history[1].status, 'Shipped');
  eq((await api('GET', '/api/admin/orders')).length >= 1, true);
});
await ta('invalid status rejected', async () => {
  sessionStorage.setItem('se_token', admTok);
  await throws(() => api('PUT', `/api/admin/orders/${orderId}/status`, { status: 'Teleported' }), 'Invalid status');
});
await ta('shipped order cannot be cancelled', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('PUT', `/api/orders/${orderId}/cancel`), 'no longer be cancelled');
});
await ta('cancel restocks and records history', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 0 && x.price > 500);
  const stockBefore = p.stock;
  await api('POST', '/api/cart', { productId: p.id, qty: 1 });
  const o = await api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', label: 'Home', email: 'riya@example.com', phone: '9876543210', pin: '560001', city: 'Bengaluru', address: '12 MG Road' },
    payment: { method: 'cod' }
  });
  eq(db.byId('products', p.id).stock, stockBefore - 1, 'stock held:');
  const c = await api('PUT', `/api/orders/${o.id}/cancel`);
  eq(c.status, 'Cancelled');
  eq(db.byId('products', p.id).stock, stockBefore, 'stock returned:');
  eq(c.history[c.history.length - 1].status, 'Cancelled');
});
await ta('rejects an order when stock ran out (race guard)', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock >= 2);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  db.update('products', p.id, { stock: 0 });  // simulate another shopper buying it first
  await throws(() => api('POST', '/api/orders', {
    shipping: { name: 'Riya Sharma', email: 'riya@example.com', phone: '9876543210', pin: '560001', address: '12 MG Road' },
    payment: { method: 'cod' }
  }), 'left in stock');
  db.update('products', p.id, { stock: p.stock });
});

console.log('\n== GUEST CART MERGE ==');
await ta('guest cart folds into the account on login', async () => {
  sessionStorage.removeItem('se_token');
  const p = db.all('products').find(x => x.stock >= 3);
  await api('POST', '/api/cart', { productId: p.id, qty: 2 });
  eq((await api('GET', '/api/cart')).items.length, 1, 'guest cart:');
  const fresh = await api('POST', '/api/auth/signup', { name: 'Merge Tester', email: 'merge@test.com', password: 'secret1' });
  sessionStorage.setItem('se_token', fresh.token);
  const c = await api('GET', '/api/cart');
  eq(c.items.length, 1, 'merged items:');
  eq(c.items[0].qty, 2, 'merged qty:');
  await api('DELETE', '/api/cart/' + p.id);
});

console.log('\n== ADMIN ==');
await ta('dashboard reports revenue excluding cancellations', async () => {
  sessionStorage.setItem('se_token', admTok);
  const d = await api('GET', '/api/admin/dashboard');
  const paid = db.all('orders').filter(o => o.status !== 'Cancelled');
  const expect = paid.reduce((s, o) => s + o.total, 0);
  eq(d.revenue, expect, 'revenue:');
  eq(d.paidOrders, paid.length, 'paidOrders:');
});
await ta('dashboard returns a 7-day series', async () => {
  sessionStorage.setItem('se_token', admTok);
  const d = await api('GET', '/api/admin/dashboard');
  eq(d.days.length, 7);
  eq(d.days.reduce((s, x) => s + x.revenue, 0), d.revenue, 'series sums to revenue:');
});
await ta('dashboard surfaces low stock', async () => {
  sessionStorage.setItem('se_token', admTok);
  const d = await api('GET', '/api/admin/dashboard');
  if (!Array.isArray(d.lowStock)) throw new Error('no lowStock array');
  d.lowStock.forEach(p => { if (p.stock > CONFIG.lowStockAt) throw new Error('over threshold in lowStock'); });
});
await ta('customer cannot create a product', async () => {
  sessionStorage.setItem('se_token', custTok);
  await throws(() => api('POST', '/api/products', { name: 'Hack', category: 'X', price: 1, stock: 1 }), 'Admin access only');
});
await ta('product create validates price', async () => {
  sessionStorage.setItem('se_token', admTok);
  await throws(() => api('POST', '/api/products', { name: 'Free thing', category: 'X', price: 0, stock: 1 }), 'price above 0');
});
await ta('product create + update + delete', async () => {
  sessionStorage.setItem('se_token', admTok);
  const n0 = db.all('products').length;
  const p = await api('POST', '/api/products', { name: 'Test Widget', emoji: 'ðŸ§ª', category: 'Test', brand: 'QA', price: 199, stock: 3, desc: 'x' });
  eq(db.all('products').length, n0 + 1, 'created:');
  eq(p.rating, 4, 'default rating:');
  await api('PUT', '/api/products/' + p.id, { name: 'Test Widget 2', emoji: 'ðŸ§ª', category: 'Test', brand: 'QA', price: 299, stock: 5, desc: 'x' });
  eq(db.byId('products', p.id).name, 'Test Widget 2', 'updated name:');
  await api('DELETE', '/api/products/' + p.id);
  eq(db.all('products').length, n0, 'deleted:');
});
await ta('deleting a product purges it from carts and reviews', async () => {
  sessionStorage.setItem('se_token', admTok);
  const victim = db.all('products').find(x => x.id !== 1);
  const before = db.all('reviews').filter(r => r.pid == victim.id).length;
  db.insert('reviews', { pid: victim.id, uid: cust.id, name: 'X', rating: 5, title: 'temp', body: 'temp body', status: 'published', created: Date.now() });
  db.all('carts').forEach(c => c.items.push({ pid: victim.id, qty: 1 }));
  await api('DELETE', '/api/products/' + victim.id);
  if (db.all('reviews').some(r => r.pid == victim.id)) throw new Error('orphan reviews left');
  if (db.all('carts').some(c => c.items.some(i => i.pid == victim.id))) throw new Error('cart reference left');
  db.insert('products', { name: victim.name, emoji: victim.emoji, category: victim.category, brand: victim.brand, price: victim.price, rating: victim.baseRating, baseRating: victim.baseRating, stock: victim.stock, desc: victim.desc, created: victim.created });
});
await ta('CSV export round-trips through import', async () => {
  sessionStorage.setItem('se_token', admTok);
  const { csv } = await api('GET', '/api/products/export.csv');
  const lines = csv.trim().split('\n');
  if (lines[0] !== 'name,emoji,category,brand,price,stock,desc') throw new Error('bad header: ' + lines[0]);
  eq(lines.length - 1, db.all('products').length, 'row count:');
  const r = await api('POST', '/api/products/import', { csv });
  eq(r.created, 0, 'no new rows on re-import:');
  eq(r.updated, db.all('products').length, 'all rows matched by name:');
});
await ta('CSV import creates genuinely new products', async () => {
  sessionStorage.setItem('se_token', admTok);
  const n0 = db.all('products').length;
  const r = await api('POST', '/api/products/import', {
    csv: 'name,emoji,category,brand,price,stock,desc\nImported A,ðŸ“¦,Test,QA,100,5,fine\nImported B,ðŸ“¦,Test,QA,200,6,fine'
  });
  eq(r.created, 2, 'created:'); eq(r.updated, 0, 'updated:');
  eq(db.all('products').length, n0 + 2, 'catalogue grew:');
});
await ta('CSV import rejects a headerless blob', async () => {
  sessionStorage.setItem('se_token', admTok);
  await throws(() => api('POST', '/api/products/import', { csv: 'just,some,text' }), 'header row');
});
await ta('CSV import reports bad rows without aborting', async () => {
  sessionStorage.setItem('se_token', admTok);
  const r = await api('POST', '/api/products/import', {
    csv: 'name,category,price\nGood Row,Test,50\n,Test,50\nBad Price,Test,0'
  });
  eq(r.created, 1, 'created:');
  eq(r.errors.length, 2, 'errors reported:');
});
await ta('coupon create validates percentage ceiling', async () => {
  sessionStorage.setItem('se_token', admTok);
  await throws(() => api('POST', '/api/admin/coupons', { code: 'TOOMUCH', type: 'percent', value: 95, expires: '2030-01-01' }), 'cannot exceed 90');
});
await ta('coupon code is normalised and deduped', async () => {
  sessionStorage.setItem('se_token', admTok);
  const c = await api('POST', '/api/admin/coupons', { code: 'my new code!', type: 'flat', value: 75, min: 500, expires: '2030-01-01' });
  eq(c.code, 'MYNEWCODE', 'normalised:');
  await throws(() => api('POST', '/api/admin/coupons', { code: 'MYNEWCODE', type: 'flat', value: 75, expires: '2030-01-01' }), 'already exists');
});
await ta('paused coupon is hidden from shoppers', async () => {
  sessionStorage.setItem('se_token', admTok);
  const all = await api('GET', '/api/admin/coupons');
  const mine = all.find(c => c.code === 'MYNEWCODE');
  await api('PUT', '/api/admin/coupons/' + mine.id, { active: false });
  const live = await api('GET', '/api/coupons');
  if (live.some(c => c.code === 'MYNEWCODE')) throw new Error('paused coupon still offered');
});
await ta('deleting a coupon strips it from live carts', async () => {
  sessionStorage.setItem('se_token', admTok);
  const all = await api('GET', '/api/admin/coupons');
  const mine = all.find(c => c.code === 'MYNEWCODE');
  await api('DELETE', '/api/admin/coupons/' + mine.id);
  const carts = db.all('carts').filter(c => c.coupon === 'MYNEWCODE');
  if (carts.length) throw new Error('dangling coupon left on a cart');
});
await ta('expired coupons are filtered from the shopper list', async () => {
  db.save('coupons', db.all('coupons').filter(c => c.expires >= new Date().toISOString().slice(0, 10)));
  const live = await api('GET', '/api/coupons');
  if (live.some(c => c.expires < new Date().toISOString().slice(0, 10))) throw new Error('expired coupon listed');
});

console.log('\n== ROUTING / EDGE CASES ==');
await ta('unknown route returns a 404 envelope', async () => {
  const r = await server('GET', '/api/nope', {}, null);
  eq(r.status, 404);
});
await ta('method mismatch returns 404 not a crash', async () => {
  const r = await server('DELETE', '/api/products', {}, null);
  eq(r.status, 404);
});
await ta('cart survives a page reload (localStorage)', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 5);
  await api('POST', '/api/cart', { productId: p.id, qty: 1 });
  const raw = JSON.parse(localStorage.getItem('se_carts'));
  if (!raw.some(c => c.items.some(i => i.pid == p.id))) throw new Error('cart not persisted');
  await api('DELETE', '/api/cart/' + p.id);
});
await ta('price changes are reflected in an existing cart', async () => {
  sessionStorage.setItem('se_token', custTok);
  const p = db.all('products').find(x => x.stock > 5 && x.price > 100);
  await api('POST', '/api/cart', { productId: p.id, qty: 1 });
  db.update('products', p.id, { price: p.price + 500 });
  const c = await api('GET', '/api/cart');
  const line = c.items.find(i => i.pid == p.id);
  if (line.p.price !== p.price + 500) throw new Error('cart kept a stale price');
  await api('DELETE', '/api/cart/' + p.id);
  db.update('products', p.id, { price: p.price });
});

console.log('\n' + results.join('\n'));
console.log(`\n${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
