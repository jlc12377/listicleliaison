# listicleliaison

Marketing site for Listicle Liaison. The pricing page includes an order builder that can start a Stripe Checkout Session.

## Checkout

`POST /api/checkout` checks one plan (monthly or annual), optional AI Visibility Tracking on that same billing interval, and the optional announcement. It then creates one Stripe Checkout Session. A plan is a subscription. The announcement is a one-time line item on that same session. AI Visibility Tracking is an add-on at $49 every month or $490 every year. Its interval must match the plan: monthly with a monthly plan, annual with an annual plan. Checkout cannot mix monthly and yearly prices.

### Vercel

Set `STRIPE_SECRET_KEY` on the Vercel project. In the Stripe Dashboard, open Developers, then API keys, and copy the secret key. A live key starts with `sk_live_`. Use `sk_test_` only while testing. Do not paste the publishable key (`pk_`).

Price IDs are built in, so the other variables are optional. Set one only to replace its default. Redeploy after changing variables.

| Variable | Default | Product |
| --- | --- | --- |
| `PRICE_BASIC_MONTHLY` | `price_1UTCosLCHEE1uM9TSM9YqBLb` | Basic Visibility, $99 every month |
| `PRICE_BASIC_ANNUAL` | `price_1UTCvcLCHEE1uM9TnGUfpjnO` | Basic Visibility, $990 every year |
| `PRICE_ENHANCED_MONTHLY` | `price_1UTCpdLCHEE1uM9TsDyKab4X` | Enhanced Visibility, $299 every month |
| `PRICE_ENHANCED_ANNUAL` | `price_1UTCwSLCHEE1uM9T57MIOhlK` | Enhanced Visibility, $2,990 every year |
| `PRICE_OPTIMAL_MONTHLY` | `price_1UTCqXLCHEE1uM9TSrzZ5rvi` | Optimal Visibility, $699 every month |
| `PRICE_OPTIMAL_ANNUAL` | `price_1UTCwxLCHEE1uM9Ta95ep0Sl` | Optimal Visibility, $6,990 every year |
| `PRICE_AI_TRACKING_MONTHLY` | `price_1UT7RmLCHEE1uM9TBq4LZTDb` | AI Visibility Tracking, $49 every month |
| `PRICE_AI_TRACKING_ANNUAL` | `price_1UVrkOLCHEE1uM9THHN3K4QO` | AI Visibility Tracking, $490 every year |
| `PRICE_ANNOUNCEMENT` | `price_1UTD00LCHEE1uM9TCZY7pxRj` | Announcement, $695 once |

An override must be a Stripe Price ID (`price_...`). A variable that is set but blank, or set to something that is not a Price ID, fails closed for that order. An unset variable keeps the default.

Plan prices and both AI Visibility Tracking prices must be recurring. The announcement price must be one-time.

### Payment Link fallback

If `STRIPE_SECRET_KEY` is missing or is not a secret key, `/api/checkout` returns 503. The pricing page then sends the visitor to the existing Stripe Payment Link for the plan they selected. That fallback does not include add-ons. The same Payment Link is used when Checkout returns an error or the request times out.

AI Visibility Tracking also has standalone Payment Links in `LL_CHECKOUT`. Monthly stays the existing $49/mo link. Annual, used when a plan card is set to annual billing and as its own add-on link, is `https://buy.stripe.com/3cIdRa71FgeTdt529pd7q0E` ($490/yr).

A successful Checkout Session returns the visitor to `/pages/thank-you.html`.
