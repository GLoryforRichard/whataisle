import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/wherebear',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3102',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP wherebear.help 127.0.0.1, MAP www.wherebear.help 127.0.0.1, MAP wherebear.whataisle.com 127.0.0.1',
        '--unsafely-treat-insecure-origin-as-secure=http://wherebear.help:3102,http://www.wherebear.help:3102',
      ],
    },
  },
  webServer: {
    command:
      'npm --prefix apps/wherebear run start -- --hostname 127.0.0.1 --port 3102',
    url: 'http://localhost:3102/api/store-identity',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      WHEREBEAR_BACKGROUND_DISABLED: '1',
      WHEREBEAR_DOMAIN_CUTOVER: '1',
      MONGODB_URI: 'mongodb://127.0.0.1:1/unused?serverSelectionTimeoutMS=100',
      MONGODB_DB: 'wherebear',
    },
  },
});
