import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { PaymentConfig, WebsiteConfig } from '@/types';

const isE2ETestMode = process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true';

// Only Stripe is wired end to end (checkout + webhook + portal). Creem was
// registered as an alternative provider but never had a webhook route, so
// selecting it would have taken payment and never fulfilled — removed.
const paymentProvider: PaymentConfig['provider'] = 'stripe';

// Non-null assertions are deliberate and must stay. These are NEXT_PUBLIC_*,
// i.e. inlined at build time, and the deploy passes only MONTHLY and LIFETIME
// as build args — the others really are undefined in production. That is
// harmless because their plans are disabled and their priceId is never read.
// Adding validation here would crash the production build.
//
// MONTHLY is the live $199/month subscription price. LIFETIME is the retired
// $999 one-time price, kept so grandfathered customers still resolve their
// plan on the billing page.
const priceIds = {
  monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY!,
  yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_YEARLY!,
  proMonthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY!,
  proYearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY!,
  lifetime: process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME!,
  creditsBasic: process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_BASIC!,
  creditsStandard: process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_STANDARD!,
  creditsPremium: process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_PREMIUM!,
  creditsEnterprise: process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_ENTERPRISE!,
};

/**
 * website config, without translations
 *
 * docs:
 * https://mksaas.com/docs/config/website
 */
export const websiteConfig: WebsiteConfig = {
  ui: {
    mode: {
      // Light-only product: dark mode was removed. Force light, hide the toggle.
      defaultMode: 'light',
      enableSwitch: false,
    },
  },
  metadata: {
    images: {
      ogImage: '/og.png?v=3',
      logoLight: '/logo.png',
      logoDark: '/logo-dark.png',
    },
  },
  features: {
    enableUpgradeCard: false,
    enableUpdateAvatar: true,
    enableDatafastRevenueTrack: false,
    enableCrispChat: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
    enableTurnstileCaptcha:
      process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true' && !isE2ETestMode,
  },
  affiliates: {
    enable: false,
    provider: 'affonso',
  },
  analytics: {
    enableVercelAnalytics: false,
    enableSpeedInsights: false,
  },
  apikeys: {
    enable: false,
  },
  auth: {
    enableGoogleLogin:
      process.env.PUBLIC_GOOGLE_LOGIN_ENABLED === 'true' ||
      process.env.NODE_ENV !== 'production',
    enableCredentialLogin: true,
    enableDeleteUser: true,
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: {
        flag: '🇺🇸',
        name: 'English',
        hreflang: 'en',
      },
      zh: {
        flag: '🇨🇳',
        name: '中文',
        hreflang: 'zh-CN',
      },
    },
  },
  // Demo store links are gone with the standalone pivot: per-store apps no
  // longer run on <handle>.<root-domain> (those subdomains now 308 to the
  // marketing site — see src/proxy.ts). Leaving the handle unset hides every
  // demo-store link (hero CTA, scan-band QR, footer) in one place.
  // demoStoreHandle: undefined,
  mail: {
    enable: true,
    provider: process.env.MAIL_PROVIDER === 'smtp' ? 'smtp' : 'resend',
    fromEmail: 'WhatAisle <noreply@whataisle.com>',
    // Plain address only: this value is interpolated into mailto: links in the
    // footer and about page, where a display-name form ("Name <addr>") breaks
    // the link. Mail providers accept a bare address as "to" just as well.
    supportEmail: 'support@whataisle.com',
  },
  newsletter: {
    enable: false,
    provider: 'resend',
    autoSubscribeAfterSignUp: false,
  },
  storage: {
    enable: true,
    // Local disk for dev; a GCS-compatible s3 driver takes over in production.
    provider: (process.env.STORAGE_PROVIDER as 's3' | 'local') ?? 'local',
  },
  payment: {
    provider: paymentProvider,
  },
  price: {
    plans: {
      // The single live plan: USD $199/month subscription. The 3-month free
      // pilot is NOT a Stripe trial — it is a 100%-off × 3 months promotion
      // coupon created by hand in the Stripe dashboard and entered by the
      // customer at checkout, hence allowPromotionCode and no trialPeriodDays.
      monthly: {
        id: 'monthly',
        prices: [
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.monthly,
            amount: 19900,
            currency: 'USD',
            interval: PlanIntervals.MONTH,
            allowPromotionCode: true,
          },
          // Annual: 10 months' price for 12 (save $398) + the store-branding
          // customization promo, fulfilled manually like the install itself.
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.yearly,
            amount: 199000,
            currency: 'USD',
            interval: PlanIntervals.YEAR,
            allowPromotionCode: true,
          },
        ],
        isFree: false,
        isLifetime: false,
        popular: true,
        credits: {
          enable: true,
          amount: 1000,
          expireDays: 30,
        },
      },
      free: {
        id: 'free',
        prices: [],
        isFree: true,
        isLifetime: false,
        // Single $199/month tier — free/pro hidden from pricing UI.
        disabled: true,
        credits: {
          enable: true,
          amount: 50,
          expireDays: 30,
        },
      },
      pro: {
        id: 'pro',
        disabled: true,
        prices: [
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.proMonthly,
            amount: 990,
            currency: 'USD',
            interval: PlanIntervals.MONTH,
          },
          {
            type: PaymentTypes.SUBSCRIPTION,
            priceId: priceIds.proYearly,
            amount: 9900,
            currency: 'USD',
            interval: PlanIntervals.YEAR,
          },
        ],
        isFree: false,
        isLifetime: false,
        popular: true,
        credits: {
          enable: true,
          amount: 1000,
          expireDays: 30,
        },
      },
      lifetime: {
        id: 'lifetime',
        // Retired 2026-08 (standalone pivot): no longer sold, but existing
        // $999 customers are grandfathered and must keep resolving this plan
        // on the billing page — disable, do NOT delete.
        disabled: true,
        prices: [
          {
            type: PaymentTypes.ONE_TIME,
            priceId: priceIds.lifetime,
            amount: 99900,
            currency: 'USD',
            allowPromotionCode: true,
          },
        ],
        isFree: false,
        isLifetime: true,
        credits: {
          enable: true,
          amount: 1000,
          expireDays: 30,
        },
      },
    },
  },
  credits: {
    enableCredits: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
    enablePackagesForFreePlan: false,
    registerGiftCredits: {
      enable: true,
      amount: 50,
      expireDays: 30,
    },
    packages: {
      basic: {
        id: 'basic',
        popular: false,
        amount: 100,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsBasic,
          amount: 990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      standard: {
        id: 'standard',
        popular: true,
        amount: 200,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsStandard,
          amount: 1490,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      premium: {
        id: 'premium',
        popular: false,
        amount: 500,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsPremium,
          amount: 3990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
      enterprise: {
        id: 'enterprise',
        popular: false,
        amount: 1000,
        expireDays: 30,
        price: {
          priceId: priceIds.creditsEnterprise,
          amount: 6990,
          currency: 'USD',
          allowPromotionCode: true,
        },
      },
    },
  },
};
