import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  completeOnboarding,
  handleForUser,
  loginByForm,
  registerE2EUser,
  updateE2EUser,
} from '../fixtures/auth';

test.describe('payment-first owner onboarding', () => {
  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('unpaid owner sees correct USD/CAD annual and monthly offers and no store creation form', async ({
    page,
    request,
  }) => {
    const owner = await registerE2EUser(request);
    await loginByForm(page, owner);
    const offer = page.getByRole('region', { name: 'Store subscription' });
    await expect(page.locator('#store-name')).toHaveCount(0);
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await offer.getByRole('button', { name: 'Annual', exact: true }).click();
    await expect(offer.getByText(/^US\$1,999\s*\/\s*year$/)).toBeVisible();
    await expect(offer.getByText(/14 months total/)).toBeVisible();
    await offer.getByLabel('Promotion code (optional)').fill('INCAD');
    await expect(offer.getByText(/^CA\$1,999\s*\/\s*year$/)).toBeVisible();
    await offer.getByRole('button', { name: 'Monthly', exact: true }).click();
    await expect(offer.getByText(/^CA\$199\s*\/\s*month$/)).toBeVisible();
    await offer.getByLabel('Promotion code (optional)').fill('1CADTEST');
    await expect(offer.getByText(/^CA\$1\s*\/\s*month$/)).toBeVisible();
    await expect(
      offer.getByRole('button', { name: 'Annual', exact: true })
    ).toHaveCount(0);
    // No hosted checkout is submitted by this price-display journey.
  });

  test('paid owner creates one recoverable store with permanent address and changes its name/password', async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const owner = await registerE2EUser(request);
    await updateE2EUser(request, { email: owner.email, hasPaid: true });
    await loginByForm(page, owner);
    await page.locator('#store-handle').fill('wherebear');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(
      page.getByText('This address is unavailable. Choose another.')
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toBeDisabled();
    const handle = handleForUser(owner);
    await completeOnboarding(page, handle);
    await expect(
      page.getByText(
        'Preparing your store address. You can leave and return to continue.'
      )
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'E2E Store' })
    ).toBeVisible();
    await expect(page.locator('#store-handle')).toHaveCount(0);
    await expect(
      page.getByText(`http://${handle}.localhost:3100`, { exact: true })
    ).toBeVisible();
    await page
      .getByLabel('Change store name', { exact: true })
      .fill('E2E Fresh Grocery');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'E2E Fresh Grocery' })
    ).toBeVisible();
    await page.getByLabel('Change 6-digit workspace password').fill('987654');
    await page.getByLabel('Confirm new password').fill('987653');
    await expect(
      page.getByRole('button', { name: 'Update password and sign out devices' })
    ).toBeDisabled();
    await page.getByLabel('Confirm new password').fill('987654');
    await page
      .getByRole('button', { name: 'Update password and sign out devices' })
      .click();
    await expect(
      page.getByText('Password updated. All staff devices must sign in again.')
    ).toBeVisible();
    await expect(
      page.getByLabel('Change 6-digit workspace password')
    ).toHaveValue('');
    expect(errors).toEqual([]);
  });

  test('billing cancellation and switching explain the retained period before any submission', async ({
    page,
    request,
  }) => {
    const owner = await registerE2EUser(request);
    await updateE2EUser(request, { email: owner.email, hasPaid: true });
    await loginByForm(page, owner);
    await page
      .getByRole('button', { name: 'Switch to annual at term end' })
      .click();
    await expect(
      page.getByText(/No charge today and no repeat bonus/)
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page
      .getByRole('button', { name: 'Cancel renewal', exact: true })
      .click();
    await expect(
      page.getByText(/Any scheduled switch is canceled/)
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm cancel renewal' })
    ).toHaveCount(0);
  });

  test('payment return waits for the signed-in owner payment and ignores an external callback', async ({
    page,
    request,
  }) => {
    const owner = await registerE2EUser(request);
    const otherOwner = await registerE2EUser(request);
    const otherPayment = await updateE2EUser(request, {
      email: otherOwner.email,
      hasPaid: true,
    });
    await loginByForm(page, owner);
    await page.goto(
      `/payment?session_id=${otherPayment!.checkoutSessionId}&callback=https://example.invalid`
    );
    await expect(
      page.getByRole('heading', { name: 'Processing Payment' })
    ).toBeVisible();
    await expect(page.locator('#store-name')).toHaveCount(0);
    // This record is fixture payment confirmation, not a real Stripe charge.
    const ownerPayment = await updateE2EUser(request, {
      email: owner.email,
      hasPaid: true,
    });
    await page.goto(
      `/payment?session_id=${ownerPayment!.checkoutSessionId}&callback=https://example.invalid`
    );
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.locator('#store-name')).toBeVisible();
  });
});
