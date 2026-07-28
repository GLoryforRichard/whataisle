import { expect, test } from '@playwright/test';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  localizedPath,
  setTheme,
  type LocaleMode,
  type ThemeMode,
} from '../fixtures/page-health';

const publicPages = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/about', name: 'about' },
  { path: '/contact', name: 'contact' },
  { path: '/cookie', name: 'cookie policy' },
  { path: '/privacy', name: 'privacy policy' },
  { path: '/terms', name: 'terms of service' },
  { path: '/auth/login', name: 'login' },
  { path: '/auth/register', name: 'register' },
  { path: '/auth/forgot-password', name: 'forgot password' },
  { path: '/auth/reset-password', name: 'reset password' },
] as const;

// Dark mode was removed — the product is light-only, so only light is exercised.
const smokeMatrix: Array<{ locale: LocaleMode; theme: ThemeMode }> = [
  { locale: 'en', theme: 'light' },
  { locale: 'zh', theme: 'light' },
];

test.describe('public page smoke coverage', () => {
  for (const { locale, theme } of smokeMatrix) {
    test(`renders all public pages in ${locale}/${theme}`, async ({ page }) => {
      await setTheme(page, theme);
      const monitor = installPageHealthMonitor(page);

      for (const publicPage of publicPages) {
        await test.step(publicPage.name, async () => {
          await expectHealthyPage(
            page,
            monitor,
            localizedPath(publicPage.path, locale),
            { theme }
          );
        });
      }
    });
  }

  test('opens the home page login modal', async ({ page }) => {
    await setTheme(page, 'light');
    const monitor = installPageHealthMonitor(page);

    await expectHealthyPage(page, monitor, '/', { theme: 'light' });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^log in$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[name="email"]')).toBeVisible();
    await expect(dialog.locator('input[name="password"]')).toBeVisible();
    monitor.expectNoErrors('home login modal');
  });

  test('health check responds with pong', async ({ request }) => {
    const response = await request.get('/api/ping');

    await expect(response).toBeOK();
    expect(await response.json()).toEqual({ message: 'pong' });
  });
});

test.describe('locale detection', () => {
  test.describe('with a Chinese-language browser', () => {
    // Sets Accept-Language: zh-CN — the signal next-intl's middleware reads
    // when no URL prefix and no NEXT_LOCALE cookie are present.
    test.use({ locale: 'zh-CN' });

    test('Chinese browsers land on the Chinese homepage', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/zh\/?$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    });
  });

  test('English browsers stay on the English homepage', async ({ page }) => {
    // Regression guard for SEO: crawlers send no zh Accept-Language and must
    // keep getting the English page at the bare domain, not a redirect.
    await page.goto('/');
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('a manual language choice is remembered across visits', async ({
    page,
  }) => {
    await page.goto('/');
    // The switcher navigates via a React transition — wait for hydration
    // before clicking, or the first click can land before handlers attach.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '中文' }).first().click();
    await expect(page).toHaveURL(/\/zh\/?$/);

    // A fresh navigation to the bare path must honor the NEXT_LOCALE cookie
    // written by the switcher.
    await page.goto('/');
    await expect(page).toHaveURL(/\/zh\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  });

  test('the homepage links to the demo store', async ({ page }) => {
    await page.goto('/');
    const demoLink = page
      .getByRole('link', { name: /visit the demo store/i })
      .first();
    await expect(demoLink).toBeVisible();
    // websiteConfig.demoStoreHandle + getStoreUrl() → the seeded `demo`
    // tenant on the localhost subdomain.
    expect(await demoLink.getAttribute('href')).toContain('//demo.localhost');
  });
});
