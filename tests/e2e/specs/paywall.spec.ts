import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  handleForUser,
  loginByForm,
  registerE2EUser,
  updateE2EUser,
} from '../fixtures/auth';

test.describe('purchase funnel and paywall', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('pricing page shows the single one-time plan', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page.getByText('$999').first()).toBeVisible();
    await expect(page.getByText('$9.9', { exact: false })).toHaveCount(0);
  });

  test('unpaid owner is walled off from video upload', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // Page gate: /manage/video sends unpaid owners to the paywall.
    await page.goto('/manage/video');
    await expect(page).toHaveURL(/\/onboarding\/payment\/?$/, {
      timeout: 15_000,
    });
    await expect(page.getByText('$999').first()).toBeVisible();

    // API gate: upload init responds 402 payment_required.
    const initResponse = await page.request.post('/api/owner/video/init', {
      data: { filename: 'walk.mp4', totalChunks: 1 },
    });
    expect(initResponse.status()).toBe(402);
    const initBody = await initResponse.json();
    expect(initBody.error).toBe('payment_required');
  });

  test('paid owner reaches the guided upload page', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await updateE2EUser(request, { email: user.email, hasPaid: true });

    // The paywall forwards paid owners to the upload page.
    await page.goto('/onboarding/payment');
    await expect(page).toHaveURL(/\/manage\/video\/?$/, { timeout: 15_000 });

    // Filming checklist renders ahead of the uploader.
    await expect(
      page.getByText(/Start at the entrance|从店门口开始/).first()
    ).toBeVisible();

    // API gate accepts the paid owner.
    const initResponse = await page.request.post('/api/owner/video/init', {
      data: { filename: `${handleForUser(user)}.mp4`, totalChunks: 1 },
    });
    expect(initResponse.ok()).toBeTruthy();
    const initBody = await initResponse.json();
    expect(initBody.videoId).toBeTruthy();
  });
});
