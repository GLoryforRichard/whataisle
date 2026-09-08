import { expect, type Page } from '@playwright/test';

export type ThemeMode = 'dark' | 'light';
export type LocaleMode = 'en' | 'zh';

export interface PageHealthMonitor {
  reset: () => void;
  expectNoErrors: (context: string) => void;
}

export function installPageHealthMonitor(page: Page): PageHealthMonitor {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`[console.error] ${message.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    errors.push(`[pageerror] ${error.message}`);
  });

  return {
    reset: () => {
      errors.length = 0;
    },
    expectNoErrors: (context) => {
      expect(errors, `${context} should not log browser errors`).toEqual([]);
    },
  };
}

export function localizedPath(path: string, locale: LocaleMode) {
  if (locale === 'en') return path;
  return path === '/' ? '/zh' : `/zh${path}`;
}

export async function setTheme(page: Page, theme: ThemeMode) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('theme', value);
  }, theme);
}

export async function expectHealthyPage(
  page: Page,
  monitor: PageHealthMonitor,
  path: string,
  options: {
    expectedPath?: RegExp;
    theme?: ThemeMode;
  } = {}
) {
  monitor.reset();

  // Smoke checks deliberately wait for automatic page reads to settle. In
  // development, navigating away during a server action can abort its request
  // and stall the next page's script compilation. This also settles the page
  // returned by the login fixture before the first protected-page navigation.
  // Network-idle waits inherit the existing navigation timeout.
  await page.waitForLoadState('networkidle');
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should return 2xx`).toBeTruthy();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toBeVisible();

  if (options.expectedPath) {
    await expect(page).toHaveURL(options.expectedPath);
  }

  if (options.theme) {
    await expect(page.locator('html')).toHaveClass(
      new RegExp(`\\b${options.theme}\\b`)
    );
  }

  // Assert health after the current page's session/plan/credit reads finish;
  // otherwise a fixed delay can miss their errors and cancel them on teardown.
  await page.waitForLoadState('networkidle');
  monitor.expectNoErrors(path);
}
