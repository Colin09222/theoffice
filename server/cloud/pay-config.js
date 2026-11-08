// The Stripe settings (see docs/PAYMENTS.md). A tiny module of its own, so config.js and tools.js can read them without loading the payment code.
import { STRIPE_API, keyMode } from './pay-provider.js';

export function paySettings(env = process.env) {
  return { stripeSecretKey: env.STRIPE_SECRET_KEY || '', stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '', stripeApiBase: (env.STRIPE_API_BASE || STRIPE_API).replace(/\/+$/, ''), stripeCountry: /^[A-Za-z]{2}$/.test(env.STRIPE_ACCOUNT_COUNTRY || '') ? env.STRIPE_ACCOUNT_COUNTRY.toLowerCase() : 'us' };
}
/** Both settings are needed: without the webhook secret a lapsed subscription would never lose access, so payments stay off. */
export const payReady = (cfg) => !!keyMode(cfg.stripeSecretKey) && !!cfg.stripeWebhookSecret;

// The payment processor's name, for pages that must say truthfully who takes the money (server/legal.js).
export const PAY_PROCESSOR = 'Stripe';
