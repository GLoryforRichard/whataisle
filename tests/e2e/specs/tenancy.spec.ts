import { expect, test } from '@playwright/test';

/**
 * Tenant isolation + host routing (requirements §5: a shopper seeing another
 * store's data is the worst-case failure).
 *
 * Precondition: `pnpm seed` has created stores `demo` (PIN 1234) and `mart2`
 * (PIN 5678). The E2E server runs on E2E_PORT (default 3100) with
 * NEXT_PUBLIC_ROOT_DOMAIN=localhost, so <handle>.localhost:<port> resolves to
 * the store.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const storeUrl = (handle: string, path = '/') =>
  `http://${handle}.localhost:${PORT}${path}`;

test.describe('store host routing', () => {
  test('known store renders its own brand', async ({ page }) => {
    await page.goto(storeUrl('demo'));
    await expect(page.getByText('Demo Market')).toBeVisible();
  });

  test('a second store renders its own brand, not the first', async ({
    page,
  }) => {
    await page.goto(storeUrl('mart2'));
    await expect(page.getByText('Second Mart')).toBeVisible();
    await expect(page.getByText('Demo Market')).toHaveCount(0);
  });

  test('unknown store shows the not-found page linking to the main site', async ({
    page,
  }) => {
    await page.goto(storeUrl('nosuchstore'));
    await expect(
      page.getByRole('heading', { name: /couldn't find this store/i })
    ).toBeVisible();
  });

  test('reserved subdomain does not resolve to a store', async ({ page }) => {
    await page.goto(storeUrl('admin'));
    await expect(
      page.getByRole('heading', { name: /couldn't find this store/i })
    ).toBeVisible();
  });
});

test.describe('staff PIN isolation', () => {
  // Distinct forwarded IPs give each test its own rate-limit bucket, so the
  // suite is robust to reruns and to manual testing against the same DB.
  test('correct PIN grants staff access on its own store', async ({
    request,
  }) => {
    const res = await request.post(
      storeUrl('demo', '/api/store/staff/session'),
      { data: { pin: '1234' }, headers: { 'x-forwarded-for': '10.0.0.1' } }
    );
    expect(res.ok()).toBeTruthy();
  });

  test('wrong PIN is rejected', async ({ request }) => {
    const res = await request.post(
      storeUrl('demo', '/api/store/staff/session'),
      { data: { pin: '0000' }, headers: { 'x-forwarded-for': '10.0.0.2' } }
    );
    expect(res.status()).toBe(401);
  });

  test('a staff session on one store never unlocks another store', async ({
    browser,
  }) => {
    // Authenticate as staff on demo.
    const context = await browser.newContext();
    const page = await context.newPage();
    const res = await context.request.post(
      storeUrl('demo', '/api/store/staff/session'),
      { data: { pin: '1234' }, headers: { 'x-forwarded-for': '10.0.0.3' } }
    );
    expect(res.ok()).toBeTruthy();

    // The demo staff cookie is host-only, so mart2 must bounce back to its PIN gate.
    await page.goto(storeUrl('mart2', '/staff/scan'));
    await expect(page).toHaveURL(storeUrl('mart2', '/staff'));

    await context.close();
  });
});

test.describe('tenant identity comes from Host, not a request header', () => {
  /**
   * Regression for a real bypass: getRequestStoreHandle() used to prefer an
   * inbound `x-store-handle` header over the Host. The proxy matcher excludes
   * /api, so on store API routes that header was neither set nor stripped —
   * forging it let anyone read another store's products unauthenticated, and
   * unlock a staff session on a store the Host did not own.
   *
   * The Host-based isolation tests above all pass even with the bug present,
   * because none of them send the header. These do.
   */
  const forged = { 'x-store-handle': 'demo' };

  test('a forged store header cannot unlock another store with its PIN', async ({
    request,
  }) => {
    // demo's PIN against mart2's host. Returned {ok:true} before the fix.
    const res = await request.post(
      storeUrl('mart2', '/api/store/staff/session'),
      {
        data: { pin: '1234' },
        headers: { ...forged, 'x-forwarded-for': '10.0.0.4' },
      }
    );
    expect(res.status()).toBe(401);
  });

  test('a forged store header cannot read another store products', async ({
    request,
  }) => {
    // mart2 has no products; demo has Wang Korea Gochujang on B4.
    const res = await request.get(
      storeUrl('mart2', '/api/store/search?q=Gochujang&input=text'),
      { headers: { ...forged, 'x-forwarded-for': '10.0.0.5' } }
    );
    const body = await res.text();

    // Assert on the parsed candidates, not the raw body: a not-found answer
    // legitimately echoes the query term back, so a bare substring check on
    // "Gochujang" fails even when isolation is holding.
    const result = body
      .split('\n')
      .find((l) => l.startsWith('data:') && l.includes('"candidates"'));
    expect(result, 'search returned no result event').toBeTruthy();
    const parsed = JSON.parse((result as string).slice('data:'.length));
    expect(parsed.candidates).toEqual([]);

    // The canonical product name and shelf code exist only in demo's data.
    expect(body).not.toContain('Wang Korea Gochujang');
    expect(body).not.toContain('shelfCode');
  });

  test('a forged store header cannot revive an unknown store host', async ({
    request,
  }) => {
    const res = await request.post(
      storeUrl('nosuchstore', '/api/store/staff/session'),
      {
        data: { pin: '1234' },
        headers: { ...forged, 'x-forwarded-for': '10.0.0.6' },
      }
    );
    expect(res.status()).toBe(404);
  });
});
