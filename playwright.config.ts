import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  // The e2e server is a single `next dev` instance; on-demand route compilation
  // during a long suite can make individual actions slow, so allow headroom and
  // a retry locally to absorb dev-server saturation flakes.
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
      'NEXT_DIST_DIR=.next-e2e',
      'BETTER_AUTH_SECRET=e2e-better-auth-secret-at-least-32-characters',
      'E2E_TEST_SECRET=mksaas-e2e-secret',
      'AI_STUB=true',
      'pnpm dev',
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
