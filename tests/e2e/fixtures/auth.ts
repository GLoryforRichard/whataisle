import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_TEST_SECRET, type E2EUser, createE2EUser } from './test-data';

const e2eHeaders = {
  'x-e2e-secret': E2E_TEST_SECRET,
};

const e2ePort = process.env.E2E_PORT ?? '3100';
const e2eOrigin =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${e2ePort}`;

export async function cleanupE2EUsers(request: APIRequestContext) {
  const response = await request.delete('/api/e2e/users', {
    headers: e2eHeaders,
  });

  expect(response.status()).toBeLessThan(500);
}

export async function registerE2EUser(
  request: APIRequestContext,
  overrides: Partial<E2EUser> = {}
) {
  const user = createE2EUser(overrides);
  const response = await request.post('/api/auth/sign-up/email', {
    headers: {
      Origin: e2eOrigin,
      Referer: `${e2eOrigin}/auth/register`,
    },
    data: {
      email: user.email,
      password: user.password,
      name: user.name,
      callbackURL: '/dashboard',
    },
  });

  expect(response.ok(), await response.text()).toBeTruthy();

  await updateE2EUser(request, {
    email: user.email,
    emailVerified: true,
    role: user.role ?? 'user',
  });

  return user;
}

export async function updateE2EUser(
  request: APIRequestContext,
  data: {
    email: string;
    emailVerified?: boolean;
    role?: 'admin' | 'user' | null;
    hasPaid?: boolean;
  }
) {
  let lastResponseText = '';

  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request.patch('/api/e2e/users', {
      headers: e2eHeaders,
      data,
    });

    if (response.ok()) {
      return (await response.json()) as {
        user: { id: string; email: string };
        checkoutSessionId: string | null;
      };
    }

    lastResponseText = await response.text();

    if (response.status() !== 404) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  expect(false, lastResponseText).toBeTruthy();
}

/**
 * Derive a valid, unique store handle from an e2e user email
 * (e2e-<random>@example.test → "e2e<random>").
 */
export function handleForUser(user: E2EUser): string {
  const base = user.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return `s${base}`.slice(0, 28);
}

/**
 * Complete the store-handle onboarding for a fresh owner. WhatAisle sends every
 * storeless owner here after login (one account = one store).
 */
export async function completeOnboarding(page: Page, handle: string) {
  await expect(page.locator('#store-name')).toBeVisible();
  await page.locator('#store-name').fill('E2E Store');
  await page.locator('#store-handle').fill(handle);
  await page.getByRole('button', { name: /^Check$|^检查$/ }).click();
  await expect(
    page.getByText(/This address is available|这个网址可以使用/)
  ).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.locator('#store-pin').fill('654321');
  await page.locator('#confirm-store-pin').fill('654321');
  await page
    .getByRole('button', { name: /Confirm and create store|确认并建立门店/ })
    .click();
  await expect(page.getByRole('heading', { name: 'E2E Store' })).toBeVisible();
}

export async function loginByForm(page: Page, user: E2EUser) {
  await page.goto('/auth/login');
  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');

  await expect(emailInput).toBeVisible();
  await emailInput.fill(user.email);
  await passwordInput.fill(user.password);
  const signInButton = page.getByRole('button', {
    name: /^sign in$|^登录$/i,
  });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  // Wait for rendered content, not the transient dashboard URL before the
  // server's terms redirect finishes.
  const terms = page.getByRole('button', { name: /^I accept$|^我同意$/i });
  const dashboard = page.getByRole('heading', {
    name: /^My store$|^我的门店$/,
  });
  await expect(terms.or(dashboard).first()).toBeVisible({ timeout: 30_000 });
  if (await terms.isVisible()) await terms.click();
  await expect(dashboard).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}
