import { defineConfig, devices } from '@playwright/test';
import { E2E_STORE_OFFER_ENV } from './tests/e2e/fixtures/store-offers';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e/specs',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Release acceptance runs with --retries=0; routine retries retain traces.
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    actionTimeout: 45_000,
    navigationTimeout: 45_000,
    trace: 'on-first-retry',
  },
  webServer: {
    command: [
      `PORT=${port}`,
      `NEXT_PUBLIC_BASE_URL=${baseURL}`,
      'NEXT_PUBLIC_ROOT_DOMAIN=localhost',
      'NEXT_PUBLIC_DEMO_WEBSITE=true',
      'NEXT_PUBLIC_E2E_TEST_MODE=true',
      'NEXT_PUBLIC_PAYMENT_PROVIDER=stripe',
      'NEXT_PUBLIC_STRIPE_PRICE_LIFETIME=price_e2e_lifetime',
      // Invalid provider credentials keep local webhook-signature tests
      // independent of developer secrets and cannot authorize Stripe calls.
      'STRIPE_SECRET_KEY=sk_test_e2e_no_network',
      'STRIPE_WEBHOOK_SECRET=whsec_e2e_no_network',
      // Preview validates actual server policy; these values cannot create a
      // real Stripe Checkout and never reuse the production offline code.
      ...Object.entries(E2E_STORE_OFFER_ENV).map(
        ([key, value]) => `${key}=${value}`
      ),
      'MAIL_PROVIDER=smtp',
      'SMTP_HOST=127.0.0.1',
      'SMTP_PORT=1025',
      // Next dev otherwise sets its heap limit to half the machine's RAM.
      // Keep the browser and compiler from forcing each other into swap.
      'NODE_OPTIONS=--max-old-space-size=3072',
      'NEXT_DIST_DIR=.next-e2e',
      'BETTER_AUTH_SECRET=e2e-better-auth-secret-at-least-32-characters',
      'E2E_TEST_SECRET=mksaas-e2e-secret',
      'AI_STUB=true',
      // Retain the development-only fixture guard while exercising the app.
      'corepack pnpm dev --turbopack',
    ].join(' '),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
