import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  completeOnboarding,
  handleForUser,
  loginByForm,
  registerE2EUser,
  updateE2EUser,
} from '../fixtures/auth';
import { E2E_TEST_SECRET } from '../fixtures/test-data';
import { E2E_BONUS_CODE, E2E_TEST_OFFER_EMAIL } from '../fixtures/store-offers';

test.describe('payment-first owner onboarding', () => {
  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('public pricing shows standard terms and registration without a coupon form', async ({
    page,
  }) => {
    await page.goto('/pricing');
    const offer = page.getByRole('region', { name: 'Store subscription' });
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await expect(offer.getByTestId('store-offer-term')).toHaveText(
      'Payment covers 1 month. Renews monthly until canceled.'
    );
    await expect(offer.getByLabel('Promotion code (optional)')).toHaveCount(0);
    await expect(
      offer.getByRole('link', { name: 'Register and open your store' })
    ).toBeVisible();
    await offer.getByRole('button', { name: 'Annual', exact: true }).click();
    await expect(offer.getByText(/^US\$1,999\s*\/\s*year$/)).toBeVisible();
    await expect(offer.getByTestId('store-offer-term')).toHaveText(
      'Payment covers 12 months. Renews annually until canceled.'
    );
    await expect(offer).not.toContainText(
      /bonus|赠送|INCAD|E2E_ONLY_TWO_MONTHS|onsite|上门/i
    );
  });

  test('unpaid owner gets standard terms and CAD only after server validation, with preview cleared on plan change', async ({
    page,
    request,
  }) => {
    const owner = await registerE2EUser(request);
    await loginByForm(page, owner);
    const offer = page.getByRole('region', { name: 'Store subscription' });
    await expect(page.locator('#store-name')).toHaveCount(0);
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await expect(offer.getByTestId('store-offer-term')).toHaveText(
      'Payment covers 1 month. Renews monthly until canceled.'
    );
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
    await offer.getByRole('button', { name: 'Annual', exact: true }).click();
    await expect(offer.getByText(/^US\$1,999\s*\/\s*year$/)).toBeVisible();
    await expect(offer.getByTestId('store-offer-term')).toHaveText(
      'Payment covers 12 months. Renews annually until canceled.'
    );
    await offer.getByLabel('Promotion code (optional)').fill('INCAD');
    await expect(offer.getByText(/^US\$1,999\s*\/\s*year$/)).toBeVisible();
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeDisabled();
    await offer.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(offer.getByText(/^CA\$1,999\s*\/\s*year$/)).toBeVisible();
    await expect(
      offer.getByText('Promotion applied.', { exact: true })
    ).toBeVisible();
    await offer.getByRole('button', { name: 'Monthly', exact: true }).click();
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await expect(
      offer.getByText('Promotion applied.', { exact: true })
    ).toHaveCount(0);
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeDisabled();
    await offer.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(offer.getByText(/^CA\$199\s*\/\s*month$/)).toBeVisible();
    await expect(offer.getByTestId('store-offer-term')).not.toContainText(
      /bonus/
    );
    await offer.getByLabel('Promotion code (optional)').fill('');
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
    // No hosted checkout is submitted by this price-display journey.
  });

  for (const plan of ['month', 'year'] as const) {
    test(`validated ${plan} bonus and CAD combination display server terms and clear on edit`, async ({
      page,
      request,
    }) => {
      const owner = await registerE2EUser(request);
      await loginByForm(page, owner);
      const offer = page.getByRole('region', { name: 'Store subscription' });
      if (plan === 'year')
        await offer
          .getByRole('button', { name: 'Annual', exact: true })
          .click();
      const total = plan === 'month' ? 3 : 14;
      const amount = plan === 'month' ? '199' : '1,999';
      const period = plan === 'month' ? 'month' : 'year';
      const price = (prefix: string) =>
        new RegExp(`^${prefix}\\$${amount}\\s*\\/\\s*${period}$`);
      await offer.getByLabel('Promotion code (optional)').fill(E2E_BONUS_CODE);
      await expect(offer.getByTestId('store-offer-term')).not.toContainText(
        /bonus/
      );
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeDisabled();
      await offer.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(offer.getByTestId('store-offer-term')).toContainText(
        `2 bonus months: ${total} months total`
      );
      await expect(offer.getByText(price('US'))).toBeVisible();
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeEnabled();
      await offer
        .getByLabel('Promotion code (optional)')
        .fill(`INCAD, ${E2E_BONUS_CODE}`);
      await expect(offer.getByTestId('store-offer-term')).not.toContainText(
        /bonus/
      );
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeDisabled();
      await offer.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(offer.getByText(price('CA'))).toBeVisible();
      await expect(offer.getByTestId('store-offer-term')).toContainText(
        `2 bonus months: ${total} months total`
      );
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeEnabled();
      await offer
        .getByRole('button', {
          name: plan === 'month' ? 'Annual' : 'Monthly',
          exact: true,
        })
        .click();
      await expect(offer.getByTestId('store-offer-term')).not.toContainText(
        /bonus/
      );
      await expect(
        offer.getByText('Promotion applied.', { exact: true })
      ).toHaveCount(0);
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeDisabled();
      await offer.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(offer.getByTestId('store-offer-term')).toContainText(
        `2 bonus months: ${plan === 'month' ? 14 : 3} months total`
      );
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeEnabled();
    });
  }

  test('invalid and account-restricted codes cannot enable checkout or show unverified benefits', async ({
    page,
    request,
  }) => {
    const owner = await registerE2EUser(request);
    await loginByForm(page, owner);
    const offer = page.getByRole('region', { name: 'Store subscription' });
    for (const code of ['NOT_A_VALID_PROMOTION', '1CADTEST']) {
      await offer.getByLabel('Promotion code (optional)').fill(code);
      await offer.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(offer.getByRole('alert')).toBeVisible();
      await expect(
        offer.getByRole('button', { name: 'Continue to payment' })
      ).toBeDisabled();
      await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
      await expect(offer.getByTestId('store-offer-term')).not.toContainText(
        /bonus/
      );
    }
    await offer.getByLabel('Promotion code (optional)').fill('');
    await expect(offer.getByRole('alert')).toHaveCount(0);
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
  });

  test('designated account can preview the test price but cannot combine it with a bonus', async ({
    page,
    request,
  }) => {
    const cleanup = await request.delete(
      `/api/e2e/users?email=${encodeURIComponent(E2E_TEST_OFFER_EMAIL)}`,
      { headers: { 'x-e2e-secret': E2E_TEST_SECRET } }
    );
    expect(cleanup.ok()).toBeTruthy();
    const owner = await registerE2EUser(request, {
      email: E2E_TEST_OFFER_EMAIL,
    });
    await loginByForm(page, owner);
    const offer = page.getByRole('region', { name: 'Store subscription' });
    await offer.getByLabel('Promotion code (optional)').fill('1CADTEST');
    await offer.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(offer.getByText(/^CA\$1\s*\/\s*month$/)).toBeVisible();
    await expect(
      offer.getByRole('button', { name: 'Annual', exact: true })
    ).toHaveCount(0);
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
    await offer
      .getByLabel('Promotion code (optional)')
      .fill(`1CADTEST + ${E2E_BONUS_CODE}`);
    await expect(offer.getByText(/^US\$199\s*\/\s*month$/)).toBeVisible();
    await offer.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(offer.getByRole('alert')).toBeVisible();
    await expect(
      offer.getByRole('button', { name: 'Continue to payment' })
    ).toBeDisabled();
    await expect(offer.getByTestId('store-offer-term')).not.toContainText(
      /bonus/
    );
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
    await expect(page.getByText(/No charge today/)).toBeVisible();
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
