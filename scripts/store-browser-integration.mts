/** Tablet UI acceptance against the production store app and disposable Mongo.
 * No platform database, external provider, API mocks or existing service reuse.
 * Defaults to review only; --run must be scheduled after competing build/E2E work.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import type { FloorMap } from '../apps/wherebear/lib/floor-map-model.mjs';
import { hashStorePin } from '../apps/wherebear/lib/runtime-crypto.mjs';

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const app = path.join(repository, 'apps/wherebear');
const mode = process.argv[2] || '--review';
assert.ok(['--review', '--run'].includes(mode), 'Use --review or --run');
assert.ok(process.argv.length <= 3, 'Unexpected arguments');

if (mode === '--review') {
  console.log(
    'Prepared only: production store app + new loopback Mongo + fixture platform + Chromium 1024x768 touch. No server, browser, build, database or output was started. Run with --run only when the main task schedules it.'
  );
} else {
  await run();
}

async function freePort() {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function run() {
  assert.equal(
    process.versions.node,
    '24.18.0',
    'Use the reviewed Node 24.18.0'
  );
  assert.notEqual(
    process.platform,
    'win32',
    'This fixture uses POSIX process groups'
  );
  await access(path.join(app, '.next/BUILD_ID'));
  await access(chromium.executablePath());
  const mongodBinary = process.env.MONGOD_BINARY || '/opt/homebrew/bin/mongod';
  assert.ok(path.isAbsolute(mongodBinary), 'MONGOD_BINARY must be absolute');
  await access(mongodBinary);
  const envFiles = (await readdir(app)).filter(
    (name) =>
      (name === '.env' || name.startsWith('.env.')) && name !== '.env.example'
  );
  assert.equal(
    envFiles.length,
    0,
    'Refusing app environment files; use the clean candidate'
  );

  const storeRequire = createRequire(path.join(app, 'package.json'));
  const { MongoClient } = storeRequire(
    'mongodb'
  ) as typeof import('../apps/wherebear/node_modules/mongodb/mongodb.d.ts');
  const sharp = storeRequire('sharp') as typeof import('sharp').default;
  const artifactParent = path.join(repository, 'output/playwright');
  await mkdir(artifactParent, { recursive: true });
  const artifacts = await mkdtemp(path.join(artifactParent, 'store-tablet-'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'whataisle-tablet-'));
  const suffix = randomBytes(6).toString('hex');
  const storeId = `tablet-${suffix}`;
  const runtimeToken = randomBytes(32).toString('hex');
  const ownerToken = randomBytes(24).toString('hex');
  const pin = '123456';
  const pinHash = hashStorePin(pin);
  const steps: string[] = [];
  const browserErrors: string[] = [];
  const blockedRequests: string[] = [];
  const children: { process: ChildProcess; name: string; logs: string }[] = [];
  const contexts: BrowserContext[] = [];
  let browser: Browser | undefined;
  let platform: ReturnType<typeof createServer> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let ownerGrantUses = 0;
  let searchReady = false;
  let failure: unknown;
  const mongoPort = await freePort();
  const runtimePort = await freePort();
  // Localhost is an explicitly supported dev origin and Chromium preserves
  // Secure cookies there; the server identity still uses the required domain.
  const base = `http://localhost:${runtimePort}`;
  const mongo = new MongoClient(`mongodb://127.0.0.1:${mongoPort}`, {
    serverSelectionTimeoutMS: 500,
  });
  const db = mongo.db(`tablet_${suffix}`);
  const scanDirectory = path.join(temporary, 'scan-jobs');
  const environment: NodeJS.ProcessEnv = {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: temporary,
    TMPDIR: temporary,
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const redact = (value: string) =>
    value
      .replaceAll(runtimeToken, '[fixture-token]')
      .replaceAll(ownerToken, '[fixture-grant]');
  function pass(label: string) {
    steps.push(label);
    console.log(`PASS ${label}`);
  }
  function child(
    name: string,
    command: string,
    args: string[],
    env = environment
  ) {
    const process = spawn(command, args, {
      cwd: app,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const item = { process, name, logs: '' };
    children.push(item);
    process.on('error', (error) => {
      item.logs += String(error);
    });
    for (const stream of [process.stdout, process.stderr])
      stream?.on('data', (chunk) => {
        item.logs = (item.logs + String(chunk)).slice(-32_000);
      });
    return process;
  }
  async function ready(
    check: () => Promise<boolean>,
    child: ChildProcess,
    name: string
  ) {
    for (let i = 0; i < 160; i++) {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid)
        throw new Error(`${name} exited before readiness`);
      try {
        if (await check()) return;
      } catch {
        /* Startup can precede listen. */
      }
      await delay(250);
    }
    throw new Error(`${name} did not become ready`);
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      await browser?.close().catch(() => {});
      await mongo.close().catch(() => {});
      for (const item of [...children].reverse()) {
        const proc = item.process;
        if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null)
          continue;
        const exited = new Promise<void>((resolve) =>
          proc.once('exit', () => resolve())
        );
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {}
        await Promise.race([exited, delay(5000)]);
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch {}
          await Promise.race([exited, delay(3000)]);
        }
      }
      if (platform) {
        platform.closeAllConnections();
        await new Promise<void>((resolve) => platform!.close(() => resolve()));
      }
      for (const item of children)
        await writeFile(
          path.join(artifacts, `${item.name}.log`),
          redact(item.logs),
          { mode: 0o600 }
        );
      // This path was allocated by this run, never accepted from caller input.
      // A live child must retain its files for inspection rather than be erased.
      if (
        children.every(
          ({ process }) =>
            !process.pid ||
            process.exitCode !== null ||
            process.signalCode !== null
        )
      )
        await rm(temporary, { recursive: true });
      else
        throw new Error(
          'A fixture child is still running; its temporary data was retained'
        );
    })();
    return cleanupPromise;
  }
  const interrupt = () => {
    failure = new Error('Fixture interrupted');
    void cleanup().catch((error) => {
      failure = error;
    });
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const watchdog = setTimeout(() => {
    failure = new Error('Tablet acceptance exceeded eight minutes');
    void cleanup().catch((error) => {
      failure = error;
    });
  }, 480_000);
  watchdog.unref();

  try {
    await Promise.all(
      ['mongo', 'scan-jobs', 'mcp-logs', 'billing'].map((name) =>
        mkdir(path.join(temporary, name))
      )
    );
    const mongoProcess = child('mongo', mongodBinary, [
      '--dbpath',
      path.join(temporary, 'mongo'),
      '--port',
      String(mongoPort),
      '--bind_ip',
      '127.0.0.1',
      '--quiet',
    ]);
    await ready(
      async () => {
        await mongo.connect();
        return true;
      },
      mongoProcess,
      'Mongo'
    );
    const json = (res: ServerResponse, status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    platform = createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url === '/owner') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Referrer-Policy': 'no-referrer',
          });
          return res.end(
            `<a href="${base}/setup?owner_token=${ownerToken}">Edit floor map</a>`
          );
        }
        if (req.headers.authorization !== `Bearer ${runtimeToken}`)
          return json(res, 401, { error: 'Unauthorized fixture request' });
        if (
          req.method === 'POST' &&
          req.url === `/api/runtime/store/${storeId}/owner-entry`
        ) {
          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 2048) return json(res, 413, {});
          }
          if (JSON.parse(body).token !== ownerToken || ownerGrantUses)
            return json(res, 403, { allowed: false });
          ownerGrantUses++;
          return json(res, 200, { allowed: true, pinVersion: 1 });
        }
        if (req.method !== 'GET' || req.url !== `/api/runtime/store/${storeId}`)
          return json(res, 404, {});
        return json(res, 200, {
          storeId,
          handle: storeId,
          displayName: 'Tablet Fixture Grocery',
          pinHash,
          pinVersion: 1,
          accessAllowed: true,
          setupAllowed: true,
          searchReady,
          serviceEndsAt: null,
          recoveryUrl: `${platformBase}/owner`,
        });
      } catch {
        return json(res, 400, { error: 'Invalid fixture request' });
      }
    });
    await new Promise<void>((resolve) =>
      platform!.listen(0, '127.0.0.1', resolve)
    );
    const platformBase = `http://127.0.0.1:${(platform.address() as { port: number }).port}`;
    const runtime = child(
      'store',
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(runtimePort),
      ],
      {
        ...environment,
        WHEREBEAR_BACKGROUND_DISABLED: '1',
        STORE_ID: storeId,
        STORE_CANONICAL_URL: `https://${storeId}.whataisle.com`,
        WHATAISLE_PLATFORM_URL: platformBase,
        STORE_RUNTIME_TOKEN: runtimeToken,
        STORE_SESSION_SECRET: randomBytes(32).toString('hex'),
        MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}`,
        MONGODB_DB: `tablet_${suffix}`,
        SCAN_JOBS_DIR: scanDirectory,
        MDB_MCP_LOG_PATH: path.join(temporary, 'mcp-logs'),
        BILLING_JOURNAL_DIR: path.join(temporary, 'billing'),
        GOOGLE_CLOUD_PROJECT: 'local-tablet-no-network',
        GOOGLE_APPLICATION_CREDENTIALS: path.join(
          temporary,
          'no-cloud-credentials'
        ),
      }
    );
    await ready(
      async () => {
        const response = await fetch(`${base}/api/runtime/health`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await response.json();
        return (
          response.ok && data.storeId === storeId && data.status === 'ready'
        );
      },
      runtime,
      'Store'
    );

    browser = await chromium.launch({ headless: true, env: environment });
    const allowedOrigins = new Set([base, platformBase]);
    async function context() {
      const value = await browser!.newContext({
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        deviceScaleFactor: 1,
        locale: 'en-US',
        serviceWorkers: 'block',
      });
      contexts.push(value);
      // Network containment only: never fulfill or replace a store API response.
      await value.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const paid = [
          '/api/search',
          '/api/identify',
          '/api/voice',
          '/api/vision',
        ];
        if (!allowedOrigins.has(url.origin) || paid.includes(url.pathname)) {
          blockedRequests.push(`${url.origin}${url.pathname}`);
          return route.abort('blockedbyclient');
        }
        await route.continue();
      });
      value.on('page', (page) =>
        page.on('pageerror', (error) =>
          browserErrors.push(redact(error.message))
        )
      );
      value.setDefaultTimeout(20_000);
      return value;
    }
    const drawingContext = await context();
    const page = await drawingContext.newPage();
    const cdp = await drawingContext.newCDPSession(page);
    const canvas = (page: Page) =>
      page.getByRole('img', { name: '货架绘制画板 / Shelf layout canvas' });
    const shelfRect = (page: Page, id: string) =>
      canvas(page).locator(`g[data-shelf="${id}"] > rect`);
    const draftKey = `whataisle:map:${storeId}:setup:0`;
    const draft = () =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) || 'null') as FloorMap | null,
        draftKey
      );
    const screenshot = (page: Page, name: string) =>
      page.screenshot({
        path: path.join(artifacts, `${name}.png`),
        fullPage: true,
      });
    async function touchDrag(
      page: Page,
      cdp: CDPSession,
      start: { x: number; y: number },
      end: { x: number; y: number }
    ) {
      const coordinates = await canvas(page).evaluate(
        (svg, points) => {
          const matrix = (svg as SVGSVGElement).getScreenCTM();
          if (!matrix) throw new Error('Canvas has no screen transform');
          return points.map((point) => {
            const transformed = new DOMPoint(point.x, point.y).matrixTransform(
              matrix
            );
            return { x: transformed.x, y: transformed.y };
          });
        },
        [start, end]
      );
      for (const point of coordinates)
        assert.ok(
          point.x >= 0 && point.x < 1024 && point.y >= 0 && point.y < 768,
          'Gesture must stay visible in tablet viewport'
        );
      const point = (x: number, y: number) => [
        { x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 },
      ];
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: point(coordinates[0].x, coordinates[0].y),
      });
      try {
        for (let i = 1; i <= 10; i++) {
          const x =
            coordinates[0].x + ((coordinates[1].x - coordinates[0].x) * i) / 10;
          const y =
            coordinates[0].y + ((coordinates[1].y - coordinates[0].y) * i) / 10;
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: point(x, y),
          });
        }
      } finally {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      }
    }
    const mapResponse = (page: Page) =>
      page.waitForResponse(
        (response) =>
          response.url() === `${base}/api/store-map` &&
          response.request().method() === 'POST'
      );
    async function confirmMap(page: Page) {
      await page
        .getByRole('button', { name: '确认保存 / Confirm', exact: true })
        .click();
      return page.getByRole('dialog', { name: '确认保存平面图' });
    }

    await page.goto(base);
    await expect(canvas(page)).toBeVisible();
    await expect(canvas(page).locator('[data-shelf]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '确认保存 / Confirm', exact: true })
    ).toBeDisabled();
    await screenshot(page, '01-empty-tablet');
    await touchDrag(page, cdp, { x: 150, y: 150 }, { x: 350, y: 270 });
    await expect(canvas(page).locator('[data-shelf]')).toHaveCount(1);
    await page.getByLabel('Shelf label', { exact: true }).fill('冷柜1');
    await page
      .getByLabel('Shelf description', { exact: true })
      .fill('Tablet dairy shelf');
    await page.getByRole('spinbutton', { name: /宽 \/ W/ }).fill('240');
    await page.getByRole('spinbutton', { name: /高 \/ H/ }).fill('100');
    await expect.poll(async () => (await draft())?.shelves[0]?.w).toBe(240);
    const first = (await draft())!.shelves[0];
    assert.match(first.id, /^s_[a-f0-9]{16}$/);
    await page
      .getByRole('button', { name: '移动 / Move', exact: true })
      .click();
    await touchDrag(
      page,
      cdp,
      { x: first.x + 60, y: first.y + 50 },
      { x: first.x + 180, y: first.y + 130 }
    );
    await expect(shelfRect(page, first.id)).toHaveAttribute(
      'x',
      String(first.x + 120)
    );
    await expect(shelfRect(page, first.id)).toHaveAttribute(
      'y',
      String(first.y + 80)
    );
    await expect(shelfRect(page, first.id)).toHaveAttribute('width', '240');
    await expect(shelfRect(page, first.id)).toHaveAttribute('height', '100');
    await page
      .getByRole('button', { name: '＋ 绘制货架 / Draw', exact: true })
      .click();
    await touchDrag(page, cdp, { x: 650, y: 400 }, { x: 830, y: 520 });
    await expect(canvas(page).locator('[data-shelf]')).toHaveCount(2);
    await page.getByLabel('Shelf label', { exact: true }).fill('Dry2');
    await expect
      .poll(async () => (await draft())?.shelves[1]?.code)
      .toBe('Dry2');
    const expectedDraft = (await draft())!;
    assert.equal(expectedDraft.shelves[1].w, 180);
    assert.equal(expectedDraft.shelves[1].h, 120);
    await screenshot(page, '02-drawn-and-moved');
    pass(
      'tablet touch adds two shelves, moves one and updates label/description/dimensions'
    );

    await page.reload();
    await expect(canvas(page).locator('[data-shelf]')).toHaveCount(2);
    assert.deepEqual(await draft(), expectedDraft);
    assert.equal(await db.collection('store_floor_map').countDocuments(), 0);
    const blankContext = await context();
    const blankPage = await blankContext.newPage();
    await blankPage.goto(base);
    await expect(canvas(blankPage)).toBeVisible();
    await expect(canvas(blankPage).locator('[data-shelf]')).toHaveCount(0);
    await blankContext.close();
    await screenshot(page, '03-restored-draft');
    pass(
      'reload restores the exact device-local draft while another browser and Mongo remain empty'
    );

    const dialog = await confirmMap(page);
    await dialog.getByLabel('Store password', { exact: true }).fill('654321');
    let saved = mapResponse(page);
    await dialog
      .getByRole('button', { name: '确认保存 / Save', exact: true })
      .click();
    assert.equal((await saved).status(), 401);
    await expect(dialog.getByRole('alert')).toBeVisible();
    assert.equal(await db.collection('store_floor_map').countDocuments(), 0);
    await screenshot(page, '04-wrong-pin');
    pass('wrong PIN displays an error without publishing the map');
    await dialog.getByLabel('Store password', { exact: true }).fill(pin);
    saved = mapResponse(page);
    await dialog
      .getByRole('button', { name: '确认保存 / Save', exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await expect(page).toHaveURL(`${base}/admin?opened=1`);
    await expect(
      page.getByRole('heading', { name: /Store preparation in progress/ })
    ).toBeVisible();
    await expect(page.getByText(/Your map is saved/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Upload photos', exact: true })
    ).toHaveCount(0);
    const published = await db
      .collection<FloorMap & { _id: string }>('store_floor_map')
      .findOne({ _id: 'published' });
    assert.deepEqual(published?.shelves, expectedDraft.shelves);
    assert.equal(published?.revision, 1);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), draftKey),
      null
    );
    await page.goto(base);
    await expect(canvas(page)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Tablet Fixture Grocery', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Staff workspace/ })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Store preparation in progress/ })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Find item/ })).toHaveCount(
      0
    );
    for (const route of ['/api/search', '/api/vision/jobs']) {
      const denied = await drawingContext.request.post(`${base}${route}`, {
        headers: { Origin: base },
        data: {},
      });
      assert.equal(denied.status(), 409);
      assert.equal((await denied.json()).code, 'store_preparing');
    }
    assert.equal(await db.collection('scan_jobs').countDocuments(), 0);
    assert.deepEqual(await readdir(scanDirectory), []);
    await screenshot(page, '05-map-saved-before-activation');
    pass(
      'correct PIN durably saves stable shelves while direct search and upload reject without queued work'
    );

    const staffContext = await context();
    const staff = await staffContext.newPage();
    await staff.goto(base);
    await expect(
      staff.getByRole('heading', { name: /Store preparation in progress/ })
    ).toBeVisible();
    const persisted = await staffContext.request.get(
      `${base}/api/runtime/config`
    );
    assert.equal(persisted.status(), 200);
    const persistedStore = await persisted.json();
    assert.equal(persistedStore.searchReady, false);
    assert.deepEqual(persistedStore.map.shelves, expectedDraft.shelves);
    assert.equal(
      await staff.evaluate((key) => localStorage.getItem(key), draftKey),
      null
    );
    pass(
      'another browser reads the confirmed map from the server without a local draft'
    );
    await staff.getByRole('link', { name: /Staff workspace/ }).click();
    await expect(
      staff.getByLabel('Store password', { exact: true })
    ).toBeVisible();
    await staff.getByLabel('Store password', { exact: true }).fill('654321');
    let staffResponse = staff.waitForResponse(
      (response) =>
        response.url() === `${base}/api/staff/session` &&
        response.request().method() === 'POST'
    );
    await staff
      .getByRole('button', {
        name: '进入工作台 / Enter workspace',
        exact: true,
      })
      .click();
    assert.equal((await staffResponse).status(), 401);
    await expect(staff.locator('form').getByRole('alert')).toHaveText(
      'Incorrect store password.'
    );
    await staff.getByLabel('Store password', { exact: true }).fill(pin);
    staffResponse = staff.waitForResponse(
      (response) =>
        response.url() === `${base}/api/staff/session` &&
        response.request().method() === 'POST'
    );
    await staff
      .getByRole('button', {
        name: '进入工作台 / Enter workspace',
        exact: true,
      })
      .click();
    assert.equal((await staffResponse).status(), 200);
    await expect(staff.getByText(/Your map is saved/)).toBeVisible();
    await expect(
      staff.getByRole('button', { name: /^Snap shelf/ })
    ).toHaveCount(0);
    // Model only the trusted platform's successful worker acknowledgement.
    // This ordinary local mongod has no Atlas Search; no index readiness claim.
    searchReady = true;
    await expect(page.getByRole('button', { name: /^Find item/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      staff.getByRole('button', { name: /^Snap shelf/ })
    ).toBeVisible({ timeout: 20_000 });
    const afterActivation = await db
      .collection<FloorMap & { _id: string }>('store_floor_map')
      .findOne({ _id: 'published' });
    assert.deepEqual(afterActivation, published);
    await page.getByRole('button', { name: /^Find item/ }).click();
    await expect(
      page.getByPlaceholder('e.g. 年糕 or black paper for sushi')
    ).toBeVisible();
    pass(
      'activation opens existing shopper and staff tabs without reloading or replacing map data'
    );
    await staff.getByRole('button', { name: /^Snap shelf/ }).click();
    await staff
      .getByRole('button', { name: 'Tap to choose a shelf', exact: true })
      .click();
    await expect(
      staff.getByRole('button', { name: '冷柜1', exact: true })
    ).toBeVisible();
    await expect(
      staff.getByRole('button', { name: 'Dry2', exact: true })
    ).toBeVisible();
    await staff.getByRole('button', { name: '冷柜1', exact: true }).click();
    await expect(
      staff.getByRole('button', { name: 'Upload photos', exact: true })
    ).toBeVisible();
    const photo = path.join(temporary, 'fixture-shelf.png');
    await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#8ca67b' },
    })
      .png()
      .toFile(photo);
    const chooser = staff.waitForEvent('filechooser');
    await staff
      .getByRole('button', { name: 'Upload photos', exact: true })
      .click();
    const accepted = staff.waitForResponse(
      (response) =>
        response.url() === `${base}/api/vision/jobs` &&
        response.request().method() === 'POST'
    );
    await (await chooser).setFiles(photo);
    const response = await accepted;
    assert.equal(response.status(), 202);
    const acceptedJob = await response.json();
    assert.match(acceptedJob.hash, /^[a-f0-9]{40}$/);
    const queued = await db
      .collection('scan_jobs')
      .findOne({ hash: acceptedJob.hash });
    assert.equal(queued?.aisle, first.id);
    assert.equal(queued?.status, 'queued');
    assert.equal(await db.collection('scan_jobs').countDocuments(), 1);
    assert.equal(await db.collection('products').countDocuments(), 0);
    assert.ok(
      (await readFile(path.join(scanDirectory, acceptedJob.hash, 'photo.bin')))
        .length > 0
    );
    await expect(
      staff.getByRole('link', { name: /^View upload queue/ })
    ).toBeVisible();
    await screenshot(staff, '06-photo-accepted');
    pass(
      'a fresh staff browser verifies PIN, selects a drawn shelf and uploads a file into its real queue/disk'
    );

    await db.collection('products').insertOne({
      name_key: `tablet_product_${suffix}`,
      canonical_name: 'Fixture milk',
      latest_aisle: first.id,
      aisles: [first.id],
    });
    await staff.goto(`${base}/setup`);
    await expect(
      staff.getByText(/Open the editor from your owner dashboard/)
    ).toBeVisible();
    await expect(canvas(staff)).toHaveCount(0);
    const ownerContext = await context();
    const owner = await ownerContext.newPage();
    await owner.goto(`${platformBase}/owner`);
    await owner
      .getByRole('link', { name: 'Edit floor map', exact: true })
      .click();
    await expect(canvas(owner)).toBeVisible();
    await expect(owner).toHaveURL(`${base}/setup`);
    assert.equal(ownerGrantUses, 1);
    await owner
      .getByRole('button', { name: '移动 / Move', exact: true })
      .click();
    const ownerCdp = await ownerContext.newCDPSession(owner);
    const current = expectedDraft.shelves[0];
    await touchDrag(
      owner,
      ownerCdp,
      { x: current.x + 60, y: current.y + 50 },
      { x: current.x + 140, y: current.y + 90 }
    );
    await expect(shelfRect(owner, first.id)).toHaveAttribute(
      'x',
      String(current.x + 80)
    );
    await owner.getByLabel('Shelf label', { exact: true }).fill('冷柜2');
    await expect(
      owner.getByRole('button', { name: '删除 / Remove', exact: true })
    ).toBeDisabled();
    const ownerDialog = await confirmMap(owner);
    await expect(
      ownerDialog.getByLabel('Store password', { exact: true })
    ).toHaveCount(0);
    saved = mapResponse(owner);
    await ownerDialog
      .getByRole('button', { name: '确认保存 / Save', exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await expect(owner).toHaveURL(`${base}/`);
    const edited = await db
      .collection<FloorMap & { _id: string }>('store_floor_map')
      .findOne({ _id: 'published' });
    assert.equal(edited?.revision, 2);
    assert.equal(edited?.shelves[0].id, first.id);
    assert.equal(edited?.shelves[0].code, '冷柜2');
    assert.equal(edited?.shelves[0].x, current.x + 80);
    const product = await db
      .collection('products')
      .findOne({ name_key: `tablet_product_${suffix}` });
    assert.equal(product?.latest_aisle, first.id);
    assert.deepEqual(product?.aisles, [first.id]);
    assert.equal(
      (await db.collection('scan_jobs').findOne({ hash: acceptedJob.hash }))
        ?.aisle,
      first.id
    );
    await staff.goto(`${base}/admin`);
    await staff.getByRole('button', { name: /^Snap shelf/ }).click();
    await staff
      .getByRole('button', { name: 'Tap to choose a shelf', exact: true })
      .click();
    await expect(
      staff.getByRole('button', { name: '冷柜2', exact: true })
    ).toBeVisible();
    await expect(
      staff.getByRole('button', { name: '冷柜1', exact: true })
    ).toHaveCount(0);
    await screenshot(staff, '07-owner-updated-picker');
    pass(
      'owner link reopens the real editor; move/rename retains product/photo IDs and updates the staff picker'
    );
    assert.deepEqual(
      blockedRequests,
      [],
      'No external or paid API may be attempted'
    );
    assert.deepEqual(browserErrors, [], 'No uncaught browser errors');
    pass(
      'all browser traffic stays local with no paid recognition/search request or uncaught UI error'
    );
  } catch (error) {
    failure = error;
    for (const [index, context] of contexts.entries()) {
      for (const [pageIndex, page] of context.pages().entries()) {
        await page
          .screenshot({
            path: path.join(artifacts, `failure-${index}-${pageIndex}.png`),
            fullPage: true,
          })
          .catch(() => {});
      }
    }
  } finally {
    clearTimeout(watchdog);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try {
      await cleanup();
    } catch (error) {
      failure ||= error;
    }
    await writeFile(
      path.join(artifacts, 'report.json'),
      JSON.stringify(
        {
          status: failure ? 'failed' : 'passed',
          checks: steps.length,
          steps,
          viewport: { width: 1024, height: 768, touch: true },
          browserErrors,
          blockedRequests,
          ...(failure
            ? {
                error: redact(
                  failure instanceof Error
                    ? failure.stack || failure.message
                    : String(failure)
                ),
              }
            : {}),
          limits:
            'Local Chromium touch emulation; fixture platform grants; real store/Mongo; AI disabled; upload acceptance only.',
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }
  console.log(
    `Tablet browser acceptance: ${steps.length} checks; report ${path.join(artifacts, 'report.json')}`
  );
  if (failure)
    throw new Error(`Tablet browser acceptance failed; inspect ${artifacts}`, {
      cause: failure,
    });
}
