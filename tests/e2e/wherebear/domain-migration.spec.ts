import { expect, test } from '@playwright/test';

test('new host identity and every other store API host stays isolated', async ({
  request,
}) => {
  const identity = await request.get('/api/store-identity', {
    headers: { Host: 'wherebear.whataisle.com' },
  });
  expect(await identity.json()).toEqual({
    storeId: 'wherebear',
    canonicalUrl: 'https://wherebear.whataisle.com',
  });
  for (const host of ['another.whataisle.com', 'www.whataisle.com']) {
    for (const path of ['/', '/api/home-summary', '/api/admin/products']) {
      expect(
        (await request.get(path, { headers: { Host: host } })).status()
      ).toBe(421);
    }
  }
});

test('both legacy hosts preserve deep links and queries in permanent redirects', async ({
  request,
}) => {
  for (const host of ['wherebear.help', 'www.wherebear.help']) {
    const response = await request.get('/admin/queue?aisle=A1', {
      headers: { Host: host },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(
      'https://wherebear.whataisle.com/admin/queue?aisle=A1'
    );
    const api = await request.get('/api/store-identity', {
      headers: { Host: host },
      maxRedirects: 0,
    });
    expect(api.status()).toBe(200);
  }
});

test.beforeEach(async ({ page }) => {
  // Real UI, zero production DB/AI operations. Unknown APIs fail the test.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/domain-migration')
      return route.fulfill({ json: { enabled: true } });
    if (path === '/api/home-summary')
      return route.fulfill({
        json: {
          ok: true,
          products: 100,
          todaySearches: 1,
          hitRate: 100,
          lastFound: 'Rice',
        },
      });
    if (path === '/api/activity')
      return route.fulfill({ json: { ok: true, activities: [] } });
    throw new Error(`Unexpected API request: ${path}`);
  });
});

test('shopper home and staff gate render at the new store host', async ({
  page,
}) => {
  await page.goto('http://wherebear.whataisle.com:3102');
  await expect(
    page.getByRole('heading', { name: /Where\s*bear/i })
  ).toBeVisible();
  await page.goto('http://wherebear.whataisle.com:3102/admin');
  await expect(
    page.getByRole('button', { name: '1', exact: true })
  ).toBeVisible();
});

test('empty old-origin queue automatically moves a browser to the matching new URL', async ({
  page,
}) => {
  await page.route('https://wherebear.whataisle.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>New store</h1>' })
  );
  await page.goto('http://wherebear.help:3102/?from=poster');
  await expect(page).toHaveURL('https://wherebear.whataisle.com/?from=poster');
});

test('unsaved old-origin photos remain accessible and prevent automatic migration', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const req = indexedDB.open('wherebear-scan', 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore('queue', { keyPath: 'id' });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put({
        id: 'migration-photo',
        aisle: 'A1',
        blob: new Blob(['photo'], { type: 'image/jpeg' }),
        status: 'failed',
        failedStage: 'detect',
        permanent: true,
        errorCode: 'unreadable',
        attempts: 3,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => db.close();
    };
  });
  await page.goto('http://wherebear.help:3102/');
  await expect(
    page.getByRole('status').filter({ hasText: 'Finishing saved photos' })
  ).toBeVisible();
  await expect(page).toHaveURL('http://wherebear.help:3102/');
  const count = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('wherebear-scan', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const count = db
            .transaction('queue', 'readonly')
            .objectStore('queue')
            .count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
        };
      })
  );
  expect(count).toBe(1);
});
