import { test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  localizedPath,
  setTheme,
  type LocaleMode,
  type ThemeMode,
} from '../fixtures/page-health';

const protectedPages = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/settings/billing', name: 'store billing' },
  { path: '/admin/users', name: 'admin users' },
  { path: '/settings/profile', name: 'profile settings' },
  { path: '/settings/security', name: 'security settings' },
] as const;

// Dark mode was removed — the product is light-only, so only light is exercised.
const smokeMatrix: Array<{ locale: LocaleMode; theme: ThemeMode }> = [
  { locale: 'en', theme: 'light' },
  { locale: 'zh', theme: 'light' },
];

test.describe('protected page smoke coverage', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  for (const { locale, theme } of smokeMatrix) {
    for (const protectedPage of protectedPages) {
      test(`renders ${protectedPage.name} in ${locale}/${theme}`, async ({
        page,
        request,
      }) => {
        // Each route owns the unchanged 60s test / 45s navigation budgets.
        // A verified owner can review account settings before payment.
        const user = await registerE2EUser(request);
        await setTheme(page, theme);
        const monitor = installPageHealthMonitor(page);

        await loginByForm(page, user);
        await expectHealthyPage(
          page,
          monitor,
          localizedPath(protectedPage.path, locale),
          { theme }
        );
      });
    }
  }
});
