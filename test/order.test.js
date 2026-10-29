const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ENV_VARS,
  DEFAULT_PRICES,
  sanitizeRep,
  validateOrder,
  sessionFields,
  siteOrigin,
} = require('../api/order');

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  PRICE_BASIC_MONTHLY: 'price_1BasicMonthly',
  PRICE_BASIC_ANNUAL: 'price_1BasicAnnual',
  PRICE_ENHANCED_MONTHLY: 'price_1EnhancedMonthly',
  PRICE_ENHANCED_ANNUAL: 'price_1EnhancedAnnual',
  PRICE_OPTIMAL_MONTHLY: 'price_1OptimalMonthly',
  PRICE_OPTIMAL_ANNUAL: 'price_1OptimalAnnual',
  PRICE_AI_TRACKING_MONTHLY: 'price_1AiTrackingMonthly',
  PRICE_AI_TRACKING_ANNUAL: 'price_1AiTrackingAnnual',
  PRICE_ANNOUNCEMENT: 'price_1Announcement',
};

test('env var list matches the Vercel names', () => {
  assert.deepEqual(ENV_VARS, [
    'STRIPE_SECRET_KEY',
    'PRICE_BASIC_MONTHLY',
    'PRICE_BASIC_ANNUAL',
    'PRICE_ENHANCED_MONTHLY',
    'PRICE_ENHANCED_ANNUAL',
    'PRICE_OPTIMAL_MONTHLY',
    'PRICE_OPTIMAL_ANNUAL',
    'PRICE_AI_TRACKING_MONTHLY',
    'PRICE_AI_TRACKING_ANNUAL',
    'PRICE_ANNOUNCEMENT',
  ]);
});

test('sanitizeRep keeps lowercase letters, digits, and hyphens, max 32', () => {
  assert.equal(sanitizeRep('Lisa'), 'lisa');
  assert.equal(sanitizeRep('Lisa Smith!'), 'lisasmith');
  assert.equal(sanitizeRep('lisa-ann'), 'lisa-ann');
  assert.equal(sanitizeRep('A'.repeat(40)), 'a'.repeat(32));
  assert.equal(sanitizeRep('!!!'), '');
  assert.equal(sanitizeRep(null), '');
  assert.equal(sanitizeRep(12), '');
});

test('monthly plan with both extras is one subscription session', () => {
  const order = validateOrder({
    plan: 'enhanced',
    interval: 'monthly',
    extras: ['announcement', 'ai-tracking', 'ai-tracking'],
    rep: 'Lisa',
    price: 'price_hacker',
  }, ENV);
  assert.equal(order.ok, true);
  assert.equal(order.mode, 'subscription');
  assert.deepEqual(order.lineItems, [
    { price: 'price_1EnhancedMonthly', quantity: 1 },
    { price: 'price_1AiTrackingMonthly', quantity: 1 },
    { price: 'price_1Announcement', quantity: 1 },
  ]);
  const fields = sessionFields(order);
  assert.equal(fields.mode, 'subscription');
  assert.equal(fields.client_reference_id, 'rep_lisa');
  assert.equal(fields.metadata.rep, 'lisa');
  assert.equal(fields.metadata.plan, 'enhanced');
  assert.equal(fields.metadata.interval, 'monthly');
  assert.equal(fields.metadata.extras, 'ai-tracking,announcement');
  assert.equal(fields.subscription_data.metadata.rep, 'lisa');
  assert.equal(fields.subscription_data.metadata.extras, 'ai-tracking,announcement');
});

test('annual plan can include the one-time announcement', () => {
  const order = validateOrder({
    plan: 'optimal',
    interval: 'annual',
    extras: ['announcement'],
    rep: 'lisa',
  }, ENV);
  assert.equal(order.ok, true);
  assert.deepEqual(order.lineItems, [
    { price: 'price_1OptimalAnnual', quantity: 1 },
    { price: 'price_1Announcement', quantity: 1 },
  ]);
});

test('AI tracking uses the same interval as the plan', () => {
  const monthly = validateOrder({
    plan: 'basic',
    interval: 'monthly',
    extras: ['ai-tracking'],
  }, ENV);
  assert.equal(monthly.ok, true);
  assert.deepEqual(monthly.lineItems, [
    { price: 'price_1BasicMonthly', quantity: 1 },
    { price: 'price_1AiTrackingMonthly', quantity: 1 },
  ]);

  const annual = validateOrder({
    plan: 'basic',
    interval: 'annual',
    extras: ['ai-tracking', 'announcement'],
  }, ENV);
  assert.equal(annual.ok, true);
  assert.deepEqual(annual.lineItems, [
    { price: 'price_1BasicAnnual', quantity: 1 },
    { price: 'price_1AiTrackingAnnual', quantity: 1 },
    { price: 'price_1Announcement', quantity: 1 },
  ]);
  assert.equal(annual.metadata.interval, 'annual');
  assert.equal(annual.metadata.extras, 'ai-tracking,announcement');
});

test('missing or unknown input is rejected', () => {
  assert.equal(validateOrder(null, ENV).status, 400);
  assert.equal(validateOrder({ plan: 'vip', interval: 'monthly', extras: [] }, ENV).status, 400);
  assert.equal(validateOrder({ plan: 'basic', interval: 'weekly', extras: [] }, ENV).status, 400);
  assert.equal(validateOrder({ plan: 'basic', interval: 'monthly', extras: 'ai-tracking' }, ENV).status, 400);
  assert.equal(validateOrder({ plan: 'basic', interval: 'monthly', extras: ['coupon'] }, ENV).status, 400);
});

test('a plan-only order omits rep fields when no rep is present', () => {
  const order = validateOrder({ plan: 'basic', interval: 'monthly' }, ENV);
  assert.equal(order.ok, true);
  assert.deepEqual(order.lineItems, [{ price: 'price_1BasicMonthly', quantity: 1 }]);
  const fields = sessionFields(order);
  assert.equal(fields.client_reference_id, undefined);
  assert.equal(fields.metadata.rep, undefined);
  assert.equal(fields.subscription_data.metadata.rep, undefined);
  assert.equal(fields.metadata.extras, undefined);
});

test('missing secret or an explicit bad price id fails closed', () => {
  assert.equal(validateOrder({ plan: 'basic', interval: 'monthly', extras: [] }, {}).status, 503);
  const missingPrice = { ...ENV, PRICE_BASIC_MONTHLY: '' };
  assert.equal(validateOrder({ plan: 'basic', interval: 'monthly', extras: [] }, missingPrice).status, 503);
  const badPrice = { ...ENV, PRICE_ANNOUNCEMENT: 'prod_announcement' };
  const order = validateOrder({
    plan: 'basic',
    interval: 'monthly',
    extras: ['announcement'],
  }, badPrice);
  assert.equal(order.status, 503);
  const blankAnnualAi = { ...ENV, PRICE_AI_TRACKING_ANNUAL: '' };
  assert.equal(
    validateOrder({ plan: 'enhanced', interval: 'annual', extras: ['ai-tracking'] }, blankAnnualAi).status,
    503
  );
  assert.equal(
    validateOrder({ plan: 'enhanced', interval: 'monthly', extras: ['ai-tracking'] }, blankAnnualAi).ok,
    true
  );
  const badKey = { ...ENV, STRIPE_SECRET_KEY: 'pk_test_abc123' };
  assert.equal(validateOrder({ plan: 'basic', interval: 'monthly', extras: [] }, badKey).status, 503);
});

test('unset price env vars use built-in Stripe price ids', () => {
  assert.deepEqual(DEFAULT_PRICES, {
    PRICE_BASIC_MONTHLY: 'price_1UTCosLCHEE1uM9TSM9YqBLb',
    PRICE_BASIC_ANNUAL: 'price_1UTCvcLCHEE1uM9TnGUfpjnO',
    PRICE_ENHANCED_MONTHLY: 'price_1UTCpdLCHEE1uM9TsDyKab4X',
    PRICE_ENHANCED_ANNUAL: 'price_1UTCwSLCHEE1uM9T57MIOhlK',
    PRICE_OPTIMAL_MONTHLY: 'price_1UTCqXLCHEE1uM9TSrzZ5rvi',
    PRICE_OPTIMAL_ANNUAL: 'price_1UTCwxLCHEE1uM9Ta95ep0Sl',
    PRICE_AI_TRACKING_MONTHLY: 'price_1UT7RmLCHEE1uM9TBq4LZTDb',
    PRICE_AI_TRACKING_ANNUAL: 'price_1UVrkOLCHEE1uM9THHN3K4QO',
    PRICE_ANNOUNCEMENT: 'price_1UTD00LCHEE1uM9TCZY7pxRj',
  });

  const onlySecret = { STRIPE_SECRET_KEY: 'sk_test_abc123' };
  const monthly = validateOrder({
    plan: 'enhanced',
    interval: 'monthly',
    extras: ['ai-tracking', 'announcement'],
  }, onlySecret);
  assert.equal(monthly.ok, true);
  assert.deepEqual(monthly.lineItems, [
    { price: 'price_1UTCpdLCHEE1uM9TsDyKab4X', quantity: 1 },
    { price: 'price_1UT7RmLCHEE1uM9TBq4LZTDb', quantity: 1 },
    { price: 'price_1UTD00LCHEE1uM9TCZY7pxRj', quantity: 1 },
  ]);

  assert.equal(
    validateOrder({ plan: 'basic', interval: 'monthly' }, onlySecret).lineItems[0].price,
    'price_1UTCosLCHEE1uM9TSM9YqBLb'
  );
  assert.equal(
    validateOrder({ plan: 'basic', interval: 'annual' }, onlySecret).lineItems[0].price,
    'price_1UTCvcLCHEE1uM9TnGUfpjnO'
  );
  assert.equal(
    validateOrder({ plan: 'enhanced', interval: 'annual' }, onlySecret).lineItems[0].price,
    'price_1UTCwSLCHEE1uM9T57MIOhlK'
  );
  assert.equal(
    validateOrder({ plan: 'optimal', interval: 'monthly' }, onlySecret).lineItems[0].price,
    'price_1UTCqXLCHEE1uM9TSrzZ5rvi'
  );
  assert.equal(
    validateOrder({ plan: 'optimal', interval: 'annual' }, onlySecret).lineItems[0].price,
    'price_1UTCwxLCHEE1uM9Ta95ep0Sl'
  );

  const annualAi = validateOrder({
    plan: 'optimal',
    interval: 'annual',
    extras: ['ai-tracking'],
  }, onlySecret);
  assert.equal(annualAi.ok, true);
  assert.deepEqual(annualAi.lineItems, [
    { price: 'price_1UTCwxLCHEE1uM9Ta95ep0Sl', quantity: 1 },
    { price: 'price_1UVrkOLCHEE1uM9THHN3K4QO', quantity: 1 },
  ]);
});

test('site origin stays on this site', () => {
  assert.equal(siteOrigin({ headers: { host: 'listicleliaison.com' } }), 'https://listicleliaison.com');
  assert.equal(siteOrigin({ headers: { host: 'www.listicleliaison.com' } }), 'https://www.listicleliaison.com');
  assert.equal(
    siteOrigin({ headers: { 'x-forwarded-host': 'listicle-liaison-git-preview.vercel.app' } }),
    'https://listicle-liaison-git-preview.vercel.app'
  );
  assert.equal(siteOrigin({ headers: { host: 'localhost:3000' } }), 'http://localhost:3000');
  assert.equal(siteOrigin({ headers: { host: 'evil.example' } }), 'https://listicleliaison.com');
  assert.equal(siteOrigin({ headers: {} }), 'https://listicleliaison.com');
});

test('pricing page keeps the payment links and adds the order builder', () => {
  const html = fs.readFileSync(path.join(__dirname, '../pages/pricing.html'), 'utf8');
  const links = [
    'https://buy.stripe.com/14A14o0Dh1jZ74H4hxd7q0x',
    'https://buy.stripe.com/7sYcN60Dh3s7ex9dS7d7q0A',
    'https://buy.stripe.com/cNieVe85J4wbcp1bJZd7q0y',
    'https://buy.stripe.com/28E5kE71F2o32Or5lBd7q0B',
    'https://buy.stripe.com/7sY14oclZd2H4Wz01hd7q0z',
    'https://buy.stripe.com/00w9AU4Tx3s7gFh9BRd7q0C',
    'https://buy.stripe.com/6oU5kEclZgeT1Kng0fd7q0w',
    'https://buy.stripe.com/3cIdRa71FgeTdt529pd7q0E',
    'https://buy.stripe.com/dRm14o71Fd2Hcp18xNd7q0D',
  ];
  for (const link of links) assert.equal(html.includes(link), true);

  assert.match(html, /id="orderCheckout"/);
  assert.match(html, /id="orderExtraAi"/);
  assert.match(html, /id="orderExtraAiPrice"/);
  assert.match(html, /id="orderExtraAnnouncement"/);
  assert.match(html, /Also available annually at \$490\/yr\./);
  assert.match(html, /AI_AMOUNTS = \{ monthly: 49, annual: 490 \}/);
  assert.equal(html.includes('monthly plans only'), false);
  assert.equal(html.includes('aiInput.disabled'), false);
  assert.match(html, /Press release published on three news sites\./);
  assert.match(html, /function withRep/);
  assert.match(html, /client_reference_id/);
  assert.match(html, /ll_rep/);
  assert.match(html, /90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(html, /\.replace\(\/\[\^a-z0-9-\]\/g, ''\)\.slice\(0, 32\)/);
  assert.match(html, /scroll-padding-top:calc\(var\(--nav-h\) \+ 16px\)/);
  assert.equal(html.includes('Franklin'), false);

  const order = html.slice(html.indexOf('id="order"'), html.indexOf('id="ai-tracking"'));
  assert.equal(/guarantee/i.test(order), false);
  assert.match(order, /network of review sites/);
  assert.equal(fs.existsSync(path.join(__dirname, '../pages/thank-you.html')), true);
});
