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
  { path: '/manage/shelves', name: 'shelves' },
  { path: '/manage/insights', name: 'insights' },
  { path: '/manage/profile', name: 'store profile' },
  { path: '/manage/posters', name: 'posters' },
  { path: '/manage/data', name: 'data & export' },
  { path: '/admin/tenants', name: 'admin tenants' },
  { path: '/admin/costs', name: 'admin costs' },
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
    test(`renders all protected pages in ${locale}/${theme}`, async ({
      page,
      request,
    }) => {
      // A regular owner: loginByForm completes onboarding so they get a store
      // and /manage/* pages render. Demo mode (e2e) lets them view /admin/*.
      const user = await registerE2EUser(request);
      await setTheme(page, theme);
      const monitor = installPageHealthMonitor(page);

      await loginByForm(page, user);

      for (const protectedPage of protectedPages) {
        await test.step(protectedPage.name, async () => {
          await expectHealthyPage(
            page,
            monitor,
            localizedPath(protectedPage.path, locale),
            { theme }
          );
        });
      }
    });
  }
});
