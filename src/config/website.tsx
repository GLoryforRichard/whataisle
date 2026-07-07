import { PaymentTypes, PlanIntervals } from '@/payment/types';
import type { PaymentConfig, WebsiteConfig } from '@/types';

const isE2ETestMode = process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true';

// Payment provider controlled by env var: 'stripe' | 'creem'
const paymentProvider = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER ||
  'stripe') as PaymentConfig['provider'];
const isCreem = paymentProvider === 'creem';

// Resolve price/product IDs based on the active payment provider
const priceIds = {
  proMonthly: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_PRO_MONTHLY!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY!,
  proYearly: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_PRO_YEARLY!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY!,
  lifetime: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_LIFETIME!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME!,
  creditsBasic: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_BASIC!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_BASIC!,
  creditsStandard: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_STANDARD!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_STANDARD!,
  creditsPremium: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_PREMIUM!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_PREMIUM!,
  creditsEnterprise: isCreem
    ? process.env.NEXT_PUBLIC_CREEM_PRODUCT_CREDITS_ENTERPRISE!
    : process.env.NEXT_PUBLIC_STRIPE_PRICE_CREDITS_ENTERPRISE!,
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
      // Store owners and staff are not tech-savvy; light mode is the familiar default.
      defaultMode: 'light',
      enableSwitch: true,
    },
  },
  metadata: {
    images: {
      ogImage: '/og.png',
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
    enable: process.env.NEXT_PUBLIC_DEMO_WEBSITE === 'true',
  },
  auth: {
    enableGoogleLogin: true,
    enableGithubLogin: false,
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
  blog: {
    enable: false,
    paginationSize: 6,
    relatedPostsSize: 3,
  },
  docs: {
    // Repurposed as the bilingual help center.
    enable: true,
  },
  mail: {
    enable: true,
    provider: process.env.MAIL_PROVIDER === 'smtp' ? 'smtp' : 'resend',
    fromEmail: 'WhatAisle <noreply@whataisle.com>',
    supportEmail: 'WhatAisle <support@whataisle.com>',
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
      free: {
        id: 'free',
        prices: [],
        isFree: true,
        isLifetime: false,
        credits: {
          enable: true,
          amount: 50,
          expireDays: 30,
        },
      },
      pro: {
        id: 'pro',
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
        prices: [
          {
            type: PaymentTypes.ONE_TIME,
            priceId: priceIds.lifetime,
            amount: 19900,
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
