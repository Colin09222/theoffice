// The email settings (see docs/MAIL.md). A tiny module of its own, so config.js can read them without loading the mail code.
import { RESEND_API } from './mail-provider.js';

/** The settings, from the environment through config.js. Tests override any of them. */
export function mailSettings(env = process.env) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
  return {
    resendApiKey: env.RESEND_API_KEY || '', resendWebhookSecret: env.RESEND_WEBHOOK_SECRET || '', resendApiBase: (env.RESEND_API_BASE || RESEND_API).replace(/\/+$/, ''),
    mailDomain: String(env.MAIL_DOMAIN || 'middistance.com').toLowerCase().trim(), mailPublicUrl: env.MAIL_PUBLIC_URL || 'https://iscolinfree.com/theoffice/',
    mailFloorDaily: n(env.MAIL_FLOOR_DAILY, 20), mailBuildingDaily: n(env.MAIL_BUILDING_DAILY, 80), mailMaxRecipients: n(env.MAIL_MAX_RECIPIENTS, 5),
    mailFloorDailyIn: n(env.MAIL_FLOOR_DAILY_IN, 60), mailFormDaily: n(env.MAIL_FORM_DAILY, 30), mailMaxAttachmentBytes: n(env.MAIL_MAX_ATTACHMENT_MB, 5) * 1024 * 1024,
    mailMaxAttachments: n(env.MAIL_MAX_ATTACHMENTS, 5), mailMaxMessageBytes: n(env.MAIL_MAX_MESSAGE_MB, 10) * 1024 * 1024, mailTickMs: n(env.MAIL_TICK_MS, 4000),
    // Resend's free plan holds three domains in all, MAIL_DOMAIN included.
    mailMaxDomains: n(env.MAIL_MAX_DOMAINS, 3), mailFloorDomains: n(env.MAIL_FLOOR_DOMAINS, 1),
  };
}

