const test = require('node:test');
const assert = require('node:assert/strict');
const checkout = require('../api/checkout');
const { DEFAULT_PRICES } = require('../api/order');

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

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function withEnv(fn) {
  const previous = {};
  for (const key of Object.keys(ENV)) {
    previous[key] = process.env[key];
    process.env[key] = ENV[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(ENV)) {
        if (previous[key] == null) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('checkout rejects non-POST requests', async () => {
  const res = mockRes();
  let called = false;
  const handler = checkout.createHandler({
    stripeFactory() {
      called = true;
      return {};
    },
  });
  await handler({ method: 'GET', body: {}, headers: { host: 'listicleliaison.com' } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(called, false);
});

test('checkout creates one session and returns its URL', async () => {
  await withEnv(async () => {
    let seenKey = '';
    let seenParams = null;
    const handler = checkout.createHandler({
      stripeFactory(key) {
        seenKey = key;
        return {
          checkout: {
            sessions: {
              async create(params) {
                seenParams = params;
                return { url: 'https://checkout.stripe.com/c/pay/cs_test_123' };
              },
            },
          },
        };
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'listicleliaison.com' },
      body: {
        plan: 'basic',
        interval: 'monthly',
        extras: ['ai-tracking', 'announcement'],
        rep: 'Lisa',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
    assert.equal(seenKey, 'sk_test_abc123');
    assert.equal(seenParams.mode, 'subscription');
    assert.equal(seenParams.client_reference_id, 'rep_lisa');
    assert.equal(seenParams.metadata.rep, 'lisa');
    assert.equal(seenParams.subscription_data.metadata.rep, 'lisa');
    assert.equal(
      seenParams.success_url,
      'https://listicleliaison.com/pages/thank-you.html?session_id={CHECKOUT_SESSION_ID}'
    );
    assert.equal(seenParams.cancel_url, 'https://listicleliaison.com/pages/pricing.html?rep=lisa');
    assert.deepEqual(seenParams.line_items, [
      { price: 'price_1BasicMonthly', quantity: 1 },
      { price: 'price_1AiTrackingMonthly', quantity: 1 },
      { price: 'price_1Announcement', quantity: 1 },
    ]);
  });
});

test('checkout uses built-in price ids when only the secret key is set', async () => {
  const keys = ['STRIPE_SECRET_KEY', ...Object.keys(DEFAULT_PRICES)];
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  process.env.STRIPE_SECRET_KEY = 'sk_live_onlysecret';
  try {
    let seenParams = null;
    const handler = checkout.createHandler({
      stripeFactory(key) {
        assert.equal(key, 'sk_live_onlysecret');
        return {
          checkout: {
            sessions: {
              async create(params) {
                seenParams = params;
                return { url: 'https://checkout.stripe.com/c/pay/cs_test_defaults' };
              },
            },
          },
        };
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'listicleliaison.com' },
      body: {
        plan: 'optimal',
        interval: 'annual',
        extras: ['ai-tracking', 'announcement'],
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seenParams.line_items, [
      { price: DEFAULT_PRICES.PRICE_OPTIMAL_ANNUAL, quantity: 1 },
      { price: DEFAULT_PRICES.PRICE_AI_TRACKING_ANNUAL, quantity: 1 },
      { price: DEFAULT_PRICES.PRICE_ANNOUNCEMENT, quantity: 1 },
    ]);
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('checkout accepts a JSON string body', async () => {
  await withEnv(async () => {
    const handler = checkout.createHandler({
      stripeFactory() {
        return {
          checkout: {
            sessions: {
              async create() {
                return { url: 'https://checkout.stripe.com/c/pay/cs_test_string' };
              },
            },
          },
        };
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'www.listicleliaison.com' },
      body: JSON.stringify({ plan: 'optimal', interval: 'annual', extras: [] }),
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_test_string');
  });
});

test('checkout returns 503 when env is missing and 502 when Stripe fails', async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const idle = checkout.createHandler({
    stripeFactory() {
      throw new Error('should not create a client');
    },
  });
  const missing = mockRes();
  await idle({
    method: 'POST',
    headers: { host: 'listicleliaison.com' },
    body: { plan: 'basic', interval: 'monthly', extras: [] },
  }, missing);
  assert.equal(missing.statusCode, 503);
  if (previous == null) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = previous;

  await withEnv(async () => {
    const handler = checkout.createHandler({
      stripeFactory() {
        return {
          checkout: {
            sessions: {
              async create() {
                const err = new Error('No such price');
                err.type = 'StripeInvalidRequestError';
                throw err;
              },
            },
          },
        };
      },
    });
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'evil.example' },
      body: { plan: 'enhanced', interval: 'monthly', extras: [] },
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'Checkout is unavailable.');
  });
});
