import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  handleForUser,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * Store closure (requirements §7: "close means delete, no retention period").
 *
 * Two properties matter and they pull in opposite directions, which is why
 * this is worth a test rather than a click-through:
 *   1. a mistyped confirmation must NOT delete anything;
 *   2. a correct one must delete everything, immediately.
 *
 * The catalog deferred this behind "persistent upload flows landing", but the
 * action has no such dependency — it is a plain server action over a cascade
 * delete. It does destroy its own tenant, so it registers a throwaway owner
 * rather than touching the seeded stores.
 */

test.describe('store closure', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a mistyped store name does not delete the store', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const handle = handleForUser(user);

    await page.goto('/manage/data');
    const input = page.locator('#confirm-name');
    await expect(input).toBeVisible();

    await input.fill('definitely not the store name');
    // The button stays disabled until the typed name matches exactly — the
    // first of the two confirmations.
    const closeButton = page.getByRole('button', {
      name: /close (this )?store|关闭门店/i,
    });
    await expect(closeButton).toBeDisabled();

    // And the store is still there.
    await page.goto('/manage/profile');
    await expect(page).toHaveURL(/\/manage\/profile\/?$/);
    expect(handle).toBeTruthy();
  });

  test('the exact store name deletes the store and frees its subdomain', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const handle = handleForUser(user);

    await page.goto('/manage/data');
    const input = page.locator('#confirm-name');
    await expect(input).toBeVisible();

    // completeOnboarding() names every E2E store this; the confirmation has
    // to match character for character.
    await input.fill('E2E Store');
    const closeButton = page.getByRole('button', {
      name: /close (this )?store|关闭门店/i,
    });
    await expect(closeButton).toBeEnabled();
    await closeButton.click();

    // Second confirmation.
    await page
      .getByRole('button', { name: /delete everything|permanently|彻底删除/i })
      .click();

    // The component sends the now-storeless owner somewhere neutral.
    await page.waitForURL(/localhost:\d+\/?$/, { timeout: 20_000 });

    // The property that actually matters: the row is gone, so the subdomain
    // stops resolving. A flag-only "closed" would still render the store.
    const PORT = Number(process.env.E2E_PORT ?? 3100);
    const res = await request.get(`http://${handle}.localhost:${PORT}/`);
    expect(await res.text()).toContain("couldn't find this store");

    // And the owner is storeless: the protected area bounces them back to
    // pick a new handle.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/onboarding\/handle\/?$/, {
      timeout: 15_000,
    });
  });
});
