const Stripe = require('stripe');
const { validateOrder, siteOrigin, sessionFields } = require('./order');

function parseBody(req) {
  if (!req || req.body == null || req.body === '') return null;
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      return null;
    }
  }
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return null;
    }
  }
  return null;
}

function createHandler(options) {
  const stripeFactory = options && options.stripeFactory
    ? options.stripeFactory
    : function (key) { return new Stripe(key); };

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (!req || req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const order = validateOrder(parseBody(req), process.env);
    if (!order.ok) {
      res.status(order.status).json({ error: order.error });
      return;
    }

    const origin = siteOrigin(req);
    const params = sessionFields(order);
    params.success_url = `${origin}/pages/thank-you.html?session_id={CHECKOUT_SESSION_ID}`;
    params.cancel_url = order.rep
      ? `${origin}/pages/pricing.html?rep=${encodeURIComponent(order.rep)}`
      : `${origin}/pages/pricing.html`;

    try {
      const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY.trim());
      const session = await stripe.checkout.sessions.create(params);
      if (!session || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
        throw new Error('Stripe did not return a checkout URL');
      }
      res.status(200).json({ url: session.url });
    } catch (err) {
      console.error('checkout_failed', err && err.message ? err.message : 'unknown');
      res.status(502).json({ error: 'Checkout is unavailable.' });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
