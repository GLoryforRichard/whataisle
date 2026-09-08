/** Platform browser acceptance only; no store build or cloud/provider calls.
 * Run after other builds/Next tests stop, with only a local DATABASE_URL set:
 * node --import tsx scripts/store-activation-browser-integration.mts
 * Creates verified synthetic owner/admin accounts, a paid provision-ready store,
 * then uses real login/forms/actions. A fixture lease is installed only on its
 * own queued job before calling the real authenticated worker failure endpoint;
 * this script never claims global queue work. Store map content is tested by
 * combined-runtime-integration.mts; this verifies its platform entry controls.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = ['localhost', '127.0.0.1', '[::1]'];
const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
assert.ok(local.includes(target.hostname), 'Refusing nonlocal PostgreSQL');
assert.equal(target.port, '5433');
assert.ok(!target.searchParams.has('host'));
for (const file of [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
]) {
  assert.equal(
    await stat(path.join(root, file)).then(
      () => true,
      () => false
    ),
    false,
    'Run in the isolated candidate without automatically loaded dotenv files'
  );
}
const port = Number(process.env.ACTIVATION_BROWSER_PORT ?? 3192);
assert.ok(Number.isInteger(port) && port >= 3100 && port <= 65000);
const base = `http://localhost:${port}`;
const probe = createServer();
await new Promise<void>((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(port, resolve);
});
await new Promise<void>((resolve) => probe.close(() => resolve()));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const ownerId = `browser-activation-${suffix}-owner`,
  adminId = `browser-activation-${suffix}-admin`;
const ownerIds = [ownerId, adminId];
const storeId = randomUUID(),
  handle = `activation-${suffix}`;
const displayName = `Activation browser grocery ${suffix}`;
const storeUrl = `http://${handle}.localhost:${port}`;
const password = `Aa9!${randomBytes(18).toString('hex')}`;
const passwordHash = await hashPassword(password);
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const workerToken = randomBytes(32).toString('hex');
const leaseToken = randomBytes(32).toString('hex');
const runtimeTokenHash = digest(randomBytes(32).toString('hex'));
const pinSalt = randomBytes(16).toString('hex');
const pinHash = `scrypt$${pinSalt}$${scryptSync('123456', pinSalt, 64).toString('hex')}`;
const artifacts = await mkdtemp(
  path.join(tmpdir(), 'whataisle-activation-browser-')
);
// The real admin page reads registry health. Block that external request at
// the process boundary; do not change its production behavior for acceptance.
const networkGuard = path.join(artifacts, 'loopback-http-only.cjs');
await writeFile(
  networkGuard,
  `
function local(target) {
  const host = typeof target === 'string' ? new URL(target).hostname :
    target instanceof URL ? target.hostname : target.hostname || target.host || 'localhost';
  if (!['localhost','127.0.0.1','[::1]','::1'].includes(String(host).replace(/:\\d+$/, '')))
    throw new Error('Local acceptance blocks external HTTP');
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  local(typeof input === 'string' || input instanceof URL ? input : input.url);
  return originalFetch.call(this, input, init);
};
for (const protocol of ['node:http','node:https']) {
  const client = require(protocol), originalRequest = client.request;
  client.request = function(...args) { local(args[0]); return originalRequest.apply(this, args); };
  client.get = function(...args) { const request = client.request(...args); request.end(); return request; };
}
`,
  { mode: 0o600 }
);
const files = ['tsconfig.json', 'next-env.d.ts'];
const originals = new Map(
  await Promise.all(
    files.map(
      async (file) => [file, await readFile(path.join(root, file))] as const
    )
  )
);
for (const [file, bytes] of originals)
  await writeFile(path.join(artifacts, file), bytes, { mode: 0o600 });
const sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
const env: NodeJS.ProcessEnv = {
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: process.env.HOME,
  TMPDIR: tmpdir(),
  NODE_ENV: 'development',
  NODE_OPTIONS: `--max-old-space-size=3072 --require=${networkGuard}`,
  PORT: String(port),
  DATABASE_URL: target.toString(),
  NEXT_PUBLIC_BASE_URL: base,
  NEXT_PUBLIC_ROOT_DOMAIN: 'localhost',
  NEXT_DIST_DIR: '.next-activation-browser',
  NEXT_PUBLIC_DEMO_WEBSITE: 'false',
  NEXT_PUBLIC_E2E_TEST_MODE: 'true',
  E2E_TEST_SECRET: 'mksaas-e2e-secret',
  BETTER_AUTH_SECRET:
    'local-activation-browser-auth-secret-at-least-32-characters',
  PROVISIONING_WORKER_TOKEN: workerToken,
  PUBLIC_SIGNUP_ENABLED: 'false',
  PUBLIC_GOOGLE_LOGIN_ENABLED: 'false',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  NEXT_PUBLIC_PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_browser_no_network',
  STRIPE_WEBHOOK_SECRET: 'whsec_browser_no_network',
  AI_STUB: 'true',
  WHEREBEAR_BACKGROUND_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
};
const log = await open(path.join(artifacts, 'server.log'), 'wx', 0o600);
let server: ChildProcess | undefined, browser: Browser | undefined;
const checks: string[] = [];
const errors: string[] = [];
let stage = 'setup';
const result = {
  checks,
  passed: false,
  fixturesRemoved: false,
  serverStopped: false,
  configurationRestored: false,
  portReleased: false,
};
const check = expect.configure({ timeout: 60_000 });
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function pass(label: string) {
  checks.push(label);
  console.log(`PASS ${label}`);
}
async function runtime() {
  return (
    await sql`select job_id, kind, status, ready_at, runtime_token_hash, runtime_version, port from store_runtime where store_id=${storeId}`
  )[0];
}
async function login(page: Page, id: string) {
  await page.goto(`${base}/auth/login`);
  await page.locator('input[name="email"]').fill(`${id}@example.test`);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  const terms = page.getByRole('button', { name: /^I accept$/i });
  const dashboard = page.getByRole('heading', { name: /^My store$/ });
  await check(terms.or(dashboard).first()).toBeVisible();
  if (await terms.isVisible()) await terms.click();
  await check(dashboard).toBeVisible();
  await check(page).toHaveURL(/\/dashboard\/?$/);
}
async function mapControls(page: Page, label: string) {
  const panel = page.getByRole('region', { name: 'My store' });
  await check(
    panel.getByRole('link', { name: 'Open store', exact: true })
  ).toHaveAttribute('href', storeUrl);
  await check(
    panel.getByRole('link', { name: 'Open store', exact: true })
  ).toBeVisible();
  await check(
    panel.getByRole('button', { name: 'Edit floor map', exact: true })
  ).toBeEnabled();
  await check(
    panel.getByText(
      'Your map can be saved. Photo uploads are being prepared.',
      { exact: true }
    )
  ).toBeVisible();
  await panel.screenshot({ path: path.join(artifacts, `${label}.png`) });
}
try {
  assert.equal(
    (await sql`select store_id from store_runtime where port=61913`).length,
    0,
    'Fixture runtime port is already in use'
  );
  await sql.begin(async (transaction) => {
    // Installed postgres 3.4.8 TransactionSql loses its runtime tag signature.
    const tx = transaction as unknown as typeof sql;
    for (const id of ownerIds) {
      await tx`insert into "user" (id,name,email,normalized_email,email_verified,role,created_at,updated_at)
        values (${id},'Local activation browser account',${`${id}@example.test`},${`${id}@example.test`},true,${id === adminId ? 'admin' : 'user'},now(),now())`;
      await tx`insert into account (id,account_id,provider_id,user_id,password,created_at,updated_at)
        values (${id},${id},'credential',${id},${passwordHash},now(),now())`;
    }
    await tx`insert into store (id,handle,display_name,owner_user_id,staff_pin_hash,status)
      values (${storeId},${handle},${displayName},${ownerId},${pinHash},'onboarding')`;
    await tx`insert into store_subscription (owner_user_id,store_id,currency,plan,status,last_paid_at,gift_used_at,entitlement_end)
      values (${ownerId},${storeId},'usd','month','active',now(),now(),now()+interval '1 month')`;
    await tx`insert into store_runtime (store_id,job_id,kind,status,port,runtime_token_hash,runtime_version,ready_at)
      values (${storeId},${randomUUID()},'provision','ready',61913,${runtimeTokenHash},'browser-map-fixture',now())`;
  });
  stage = 'local Next startup';
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--turbopack',
      '--port',
      String(port),
    ],
    {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    }
  );
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error('Local server exited');
    try {
      if (
        (
          await fetch(`${base}/api/auth/get-session`, {
            signal: AbortSignal.timeout(1500),
          })
        ).status === 200
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert.ok(ready, 'Local authentication server was not ready');
  console.log(
    `Local activation browser service ready on ${port}; artifacts: ${artifacts}`
  );
  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  for (const context of [ownerContext, adminContext]) {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return local.includes(url.hostname) ? route.continue() : route.abort();
    });
    context.on('page', (page) => {
      page.setDefaultTimeout(60_000);
      page.setDefaultNavigationTimeout(60_000);
      page.on('pageerror', () => errors.push('Browser page error'));
    });
  }
  const ownerPage = await ownerContext.newPage(),
    adminPage = await adminContext.newPage();
  stage = 'owner login and map entry';
  await login(ownerPage, ownerId);
  await mapControls(ownerPage, 'owner-map-ready');
  pass('real owner login reaches provision-ready map entry controls');
  stage = 'founder login and activation';
  await login(adminPage, adminId);
  await adminPage.goto(`${base}/admin/stores`);
  const card = adminPage
    .getByRole('heading', { name: `${displayName} · ${handle}`, exact: true })
    .locator('..');
  const enable = card.getByRole('button', {
    name: 'Enable search and photo uploads',
    exact: true,
  });
  await check(enable).toBeEnabled();
  const before = await runtime();
  await enable.click();
  await check.poll(async () => (await runtime()).kind).toBe('activate');
  await check.poll(async () => (await runtime()).status).toBe('queued');
  const queued = await runtime();
  assert.notEqual(queued.job_id, before.job_id);
  for (const key of [
    'ready_at',
    'runtime_token_hash',
    'runtime_version',
    'port',
  ])
    assert.ok(
      JSON.stringify(queued[key]) === JSON.stringify(before[key]),
      'Activation must preserve map runtime identity'
    );
  await check(enable).toHaveCount(0);
  await card.screenshot({
    path: path.join(artifacts, 'founder-activation-queued.png'),
  });
  pass(
    'real founder activation click creates one queued job with existing runtime identity'
  );
  stage = 'queued owner map entry';
  await ownerPage.reload();
  await mapControls(ownerPage, 'owner-activation-queued');
  pass(
    'owner map link and edit control remain available while activation is queued'
  );
  stage = 'worker failure API';
  // Scope the fixture lease to the job this real click created; do not claim
  // or lock unrelated rows from the global provisioning queue.
  const leased =
    await sql`update store_runtime set status='provisioning',worker_id='activation-browser-fixture',
    lease_token_hash=${digest(leaseToken)},lease_expires_at=now()+interval '5 minutes',attempts=attempts+1
    where store_id=${storeId} and job_id=${queued.job_id} and status='queued' returning store_id`;
  assert.equal(leased.length, 1);
  const failure = await fetch(`${base}/api/internal/provisioning/fail`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jobId: queued.job_id,
      leaseToken,
      code: 'SEARCH_TIER_NOT_SUPPORTED',
      retryable: false,
    }),
  });
  assert.equal(
    failure.status,
    200,
    'Existing authenticated worker endpoint must record its owned failure'
  );
  assert.equal((await runtime()).status, 'failed');
  pass(
    'real worker failure HTTP endpoint accepts only the fixture job lease and marks it failed'
  );
  stage = 'failed owner map entry';
  await ownerPage.reload();
  await mapControls(ownerPage, 'owner-activation-failed');
  pass(
    'owner map link and edit control remain available after activation failure'
  );
  stage = 'founder retry';
  await adminPage.reload();
  const retry = card.getByRole('button', {
    name: 'Retry store job',
    exact: true,
  });
  await check(retry).toBeEnabled();
  await card.screenshot({
    path: path.join(artifacts, 'founder-activation-failed.png'),
  });
  await retry.click();
  await check.poll(async () => (await runtime()).status).toBe('queued');
  const retried = await runtime();
  assert.equal(retried.job_id, queued.job_id);
  for (const key of [
    'ready_at',
    'runtime_token_hash',
    'runtime_version',
    'port',
  ])
    assert.ok(
      JSON.stringify(retried[key]) === JSON.stringify(before[key]),
      'Retry must preserve map runtime identity'
    );
  assert.equal(
    (
      await sql`select id from audit_log where store_id=${storeId} and action='runtime.activation_requested'`
    ).length,
    1
  );
  assert.equal(
    (
      await sql`select id from audit_log where store_id=${storeId} and action='runtime.retry_requested'`
    ).length,
    1
  );
  assert.equal(errors.length, 0, 'No browser hydration or page errors');
  pass(
    'real founder retry returns the same job to queued without duplicate activation'
  );
  result.passed = true;
} catch {
  console.error(
    `FAIL activation browser acceptance at stage: ${stage}; restricted artifacts: ${artifacts}`
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
    for (
      let i = 0;
      i < 50 && server.exitCode === null && server.signalCode === null;
      i++
    )
      await delay(100);
    if (server.exitCode === null && server.signalCode === null) {
      try {
        process.kill(-server.pid, 'SIGKILL');
      } catch {}
    }
    result.serverStopped =
      server.exitCode !== null || server.signalCode !== null;
  } else result.serverStopped = true;
  await log.close();
  for (const [file, bytes] of originals)
    await writeFile(path.join(root, file), bytes);
  result.configurationRestored = (
    await Promise.all(
      [...originals].map(async ([file, bytes]) =>
        (await readFile(path.join(root, file))).equals(bytes)
      )
    )
  ).every(Boolean);
  try {
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as typeof sql;
      await tx`delete from store_owner_entry where store_id=${storeId}`;
      await tx`delete from audit_log where store_id=${storeId}`;
      await tx`delete from store_runtime where store_id=${storeId}`;
      await tx`delete from store_subscription where owner_user_id=${ownerId}`;
      await tx`delete from store where id=${storeId}`;
      await tx`delete from store_terms_acceptance where user_id in ${sql(ownerIds)}`;
      await tx`delete from session where user_id in ${sql(ownerIds)}`;
      await tx`delete from account where user_id in ${sql(ownerIds)}`;
      await tx`delete from "user" where id in ${sql(ownerIds)}`;
    });
    result.fixturesRemoved =
      (await sql`select id from "user" where id in ${sql(ownerIds)}`).length ===
        0 &&
      (await sql`select store_id from store_runtime where store_id=${storeId}`)
        .length === 0 &&
      (await sql`select id from store where id=${storeId}`).length === 0;
  } catch {
    console.error(
      `Fixture cleanup requires retry for store ${storeId} and account prefix browser-activation-${suffix}`
    );
    process.exitCode = 1;
  }
  await sql.end({ timeout: 5 });
  const available = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      available.once('error', reject);
      available.listen(port, resolve);
    });
    result.portReleased = true;
  } catch {
  } finally {
    if (available.listening)
      await new Promise<void>((resolve) => available.close(() => resolve()));
  }
  if (
    !result.fixturesRemoved ||
    !result.serverStopped ||
    !result.configurationRestored ||
    !result.portReleased
  )
    process.exitCode = 1;
  await writeFile(
    path.join(artifacts, 'result.json'),
    JSON.stringify(result, null, 2),
    { mode: 0o600 }
  );
  console.log(JSON.stringify(result));
}
