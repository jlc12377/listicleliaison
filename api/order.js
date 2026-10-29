// Subscription Checkout can include one-time prices.
// It cannot mix billing intervals. AI Visibility Tracking uses the same
// interval as the plan: monthly with monthly, annual with annual.

const PLANS = ['basic', 'enhanced', 'optimal'];
const INTERVALS = ['monthly', 'annual'];

const PLAN_PRICE_ENV = {
  basic: { monthly: 'PRICE_BASIC_MONTHLY', annual: 'PRICE_BASIC_ANNUAL' },
  enhanced: { monthly: 'PRICE_ENHANCED_MONTHLY', annual: 'PRICE_ENHANCED_ANNUAL' },
  optimal: { monthly: 'PRICE_OPTIMAL_MONTHLY', annual: 'PRICE_OPTIMAL_ANNUAL' },
};

const EXTRA_PRICE_ENV = {
  'ai-tracking': {
    monthly: 'PRICE_AI_TRACKING_MONTHLY',
    annual: 'PRICE_AI_TRACKING_ANNUAL',
  },
  announcement: 'PRICE_ANNOUNCEMENT',
};

// Used when that env var is unset. A set variable replaces its default,
// including a blank value, which still fails closed.
const DEFAULT_PRICES = {
  PRICE_BASIC_MONTHLY: 'price_1UTCosLCHEE1uM9TSM9YqBLb',
  PRICE_BASIC_ANNUAL: 'price_1UTCvcLCHEE1uM9TnGUfpjnO',
  PRICE_ENHANCED_MONTHLY: 'price_1UTCpdLCHEE1uM9TsDyKab4X',
  PRICE_ENHANCED_ANNUAL: 'price_1UTCwSLCHEE1uM9T57MIOhlK',
  PRICE_OPTIMAL_MONTHLY: 'price_1UTCqXLCHEE1uM9TSrzZ5rvi',
  PRICE_OPTIMAL_ANNUAL: 'price_1UTCwxLCHEE1uM9Ta95ep0Sl',
  PRICE_AI_TRACKING_MONTHLY: 'price_1UT7RmLCHEE1uM9TBq4LZTDb',
  PRICE_AI_TRACKING_ANNUAL: 'price_1UVrkOLCHEE1uM9THHN3K4QO',
  PRICE_ANNOUNCEMENT: 'price_1UTD00LCHEE1uM9TCZY7pxRj',
};

const EXTRA_ORDER = ['ai-tracking', 'announcement'];

const ENV_VARS = [
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
];

function sanitizeRep(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

function readPrice(env, name) {
  const set = !!(env && Object.prototype.hasOwnProperty.call(env, name));
  const value = set
    ? (typeof env[name] === 'string' ? env[name].trim() : '')
    : (DEFAULT_PRICES[name] || '');
  if (!/^price_[A-Za-z0-9]+$/.test(value)) return '';
  return value;
}

function priceEnvForExtra(name, interval) {
  const spec = EXTRA_PRICE_ENV[name];
  if (typeof spec === 'string') return spec;
  // Recurring add-ons bill on the plan interval, so the prices cannot mix.
  if (!spec || !Object.prototype.hasOwnProperty.call(spec, interval)) return '';
  return spec[interval];
}

function hasSecret(env) {
  const value = env && typeof env.STRIPE_SECRET_KEY === 'string'
    ? env.STRIPE_SECRET_KEY.trim()
    : '';
  return /^sk_(test|live)_[A-Za-z0-9]+$/.test(value);
}

function validateOrder(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid order.' };
  }

  const plan = body.plan;
  const interval = body.interval;
  if (!PLANS.includes(plan) || !INTERVALS.includes(interval)) {
    return { ok: false, status: 400, error: 'Choose a plan and a billing interval.' };
  }

  const rawExtras = body.extras == null ? [] : body.extras;
  if (!Array.isArray(rawExtras)) {
    return { ok: false, status: 400, error: 'Invalid extras.' };
  }

  const extras = [];
  for (const item of rawExtras) {
    if (typeof item !== 'string' || !Object.prototype.hasOwnProperty.call(EXTRA_PRICE_ENV, item)) {
      return { ok: false, status: 400, error: 'Unknown extra.' };
    }
    if (!extras.includes(item)) extras.push(item);
  }

  if (!hasSecret(env)) {
    return { ok: false, status: 503, error: 'Checkout is not configured.' };
  }

  const planPrice = readPrice(env, PLAN_PRICE_ENV[plan][interval]);
  if (!planPrice) {
    return { ok: false, status: 503, error: 'Checkout is not configured.' };
  }

  const orderedExtras = EXTRA_ORDER.filter((name) => extras.includes(name));
  const lineItems = [{ price: planPrice, quantity: 1 }];
  for (const name of orderedExtras) {
    const priceEnv = priceEnvForExtra(name, interval);
    if (!priceEnv) {
      return {
        ok: false,
        status: 400,
        error: 'AI Visibility Tracking must use the same billing interval as the plan.',
      };
    }
    const price = readPrice(env, priceEnv);
    if (!price) return { ok: false, status: 503, error: 'Checkout is not configured.' };
    lineItems.push({ price, quantity: 1 });
  }

  const rep = sanitizeRep(body.rep);
  const metadata = { plan, interval };
  const subscriptionMetadata = { plan, interval };
  if (orderedExtras.length) {
    metadata.extras = orderedExtras.join(',');
    subscriptionMetadata.extras = orderedExtras.join(',');
  }
  if (rep) {
    metadata.rep = rep;
    subscriptionMetadata.rep = rep;
  }

  return {
    ok: true,
    mode: 'subscription',
    lineItems,
    rep,
    metadata,
    subscriptionMetadata,
  };
}

function sessionFields(order) {
  const fields = {
    mode: 'subscription',
    line_items: order.lineItems,
    metadata: order.metadata,
    subscription_data: {
      metadata: order.subscriptionMetadata,
    },
  };
  if (order.rep) fields.client_reference_id = `rep_${order.rep}`;
  return fields;
}

function siteOrigin(req) {
  const headers = (req && req.headers) || {};
  const raw = headers['x-forwarded-host'] || headers.host || '';
  const host = String(raw).split(',')[0].trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, '');
  const allowed =
    hostname === 'listicleliaison.com' ||
    hostname === 'www.listicleliaison.com' ||
    hostname.endsWith('.vercel.app') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';
  if (!allowed || !host) return 'https://listicleliaison.com';
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  return `${local ? 'http' : 'https'}://${host}`;
}

module.exports = {
  ENV_VARS,
  DEFAULT_PRICES,
  PLAN_PRICE_ENV,
  EXTRA_PRICE_ENV,
  sanitizeRep,
  validateOrder,
  sessionFields,
  siteOrigin,
};
