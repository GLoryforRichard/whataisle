/** Real platform Next server + store Next server + local PostgreSQL/Mongo.
 * Run with Node 24: node --env-file=.env --import tsx scripts/combined-runtime-integration.mts
 * Unique combined-*@example.test owners never overlap the root E2E cleanup pattern.
 * No payment provider, mail, cloud/AI or production request is made. Billing state
 * transitions are seeded locally; the real platform HTTP access API evaluates them.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/wherebear');
const require = createRequire(import.meta.url);
const storeRequire = createRequire(path.join(app, 'package.json'));
const { MongoClient } = storeRequire(
  'mongodb'
) as typeof import('../apps/wherebear/node_modules/mongodb');
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === 'server-only'
        ? 'next/dist/compiled/server-only/empty.js'
        : specifier,
      context
    );
  },
});
const target = new URL(process.env.DATABASE_URL || 'postgres://invalid');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
  'Refusing nonlocal PostgreSQL'
);
assert.equal(
  target.port,
  '5433',
  'Only the existing development PostgreSQL on 5433 is allowed'
);
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const artifactDirectory = await mkdtemp(
  path.join(tmpdir(), 'whataisle-combined-')
);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const platformPort = await freePort();
const storePort = await freePort();
const mongoPort = await freePort();
const platformBase = `http://localhost:${platformPort}`;
const runtimeBase = `http://localhost:${storePort}`;
const distName = `.next-combined-${suffix}`;
const tsconfigFile = path.join(root, 'tsconfig.json');
const nextEnvFile = path.join(root, 'next-env.d.ts');
const originalTsconfig = await readFile(tsconfigFile, 'utf8');
const originalNextEnv = await readFile(nextEnvFile, 'utf8');
process.env.NEXT_PUBLIC_BASE_URL = platformBase;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'whataisle.com';
const { getDb } =
  require('../src/db/index') as typeof import('../src/db/index');
const { user } =
  require('../src/db/auth.schema') as typeof import('../src/db/auth.schema');
const { storeOwnerEntry, storeRuntime } =
  require('../src/db/runtime.schema') as typeof import('../src/db/runtime.schema');
const { auditLog, store } =
  require('../src/db/store.schema') as typeof import('../src/db/store.schema');
const { storeSubscription } =
  require('../src/db/subscription.schema') as typeof import('../src/db/subscription.schema');
const { createOwnerStore, createOwnerMapEntry, updateOwnerStore } =
  require('../src/data/owner-store') as typeof import('../src/data/owner-store');
const { newSecret, secretDigest } =
  require('../src/lib/store-secrets') as typeof import('../src/lib/store-secrets');
const db = await getDb();
const ownerId = `combined-${suffix}`;
const handle = `combined-${suffix}`;
const runtimeToken = newSecret();
const children: ChildProcess[] = [];
const mongo = new MongoClient(`mongodb://127.0.0.1:${mongoPort}`, {
  serverSelectionTimeoutMS: 500,
});
let storeId: string | undefined;
let checks = 0;
function child(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
) {
  const process = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(process);
  process.stdout?.on('data', () => {});
  process.stderr?.on('data', () => {});
  return process;
}
async function ready(
  check: () => Promise<boolean>,
  process: ChildProcess,
  label: string
) {
  for (let i = 0; i < 240; i++) {
    if (process.exitCode !== null)
      throw new Error(`${label} exited (${process.exitCode})`);
    try {
      if (await check()) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`${label} did not become ready`);
}
function pass(label: string) {
  checks++;
  console.log(`PASS ${label}`);
}
async function request(
  url: string,
  body?: unknown,
  cookie?: string,
  method = body === undefined ? 'GET' : 'POST'
) {
  return fetch(url, {
    method,
    headers: {
      Origin: new URL(url).origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookie(response: Response) {
  const value = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(value, 'Expected a server-issued cookie');
  return value;
}
async function config() {
  const response = await request(`${runtimeBase}/api/runtime/config`);
  assert.equal(response.status, 200);
  return response.json();
}
const map = {
  revision: 0,
  width: 1200,
  height: 900,
  shelves: [
    {
      id: 's_0123456789abcdef',
      code: 'A1',
      description: 'Combined fixture',
      x: 40,
      y: 40,
      w: 100,
      h: 60,
    },
  ],
};
try {
  await db.insert(user).values({
    id: ownerId,
    name: 'Combined runtime fixture',
    email: `${ownerId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(storeSubscription).values({
    ownerUserId: ownerId,
    currency: 'usd',
    plan: 'month',
    status: 'active',
    periodStart: new Date(),
    entitlementEnd: new Date(Date.now() + 90 * 86400_000),
    giftUsedAt: new Date(),
  });
  const created = await createOwnerStore(ownerId, {
    displayName: 'Combined original store',
    handle,
    pin: '123456',
  });
  storeId = created.storeId;
  await db
    .update(storeRuntime)
    .set({
      status: 'ready',
      runtimeTokenHash: secretDigest(runtimeToken),
      readyAt: new Date(),
    })
    .where(eq(storeRuntime.storeId, storeId));
  const mongoDir = path.join(artifactDirectory, 'mongo');
  await mkdir(mongoDir);
  const mongoProcess = child(
    process.env.MONGOD_BINARY || '/opt/homebrew/bin/mongod',
    [
      '--dbpath',
      mongoDir,
      '--port',
      String(mongoPort),
      '--bind_ip',
      '127.0.0.1',
      '--quiet',
    ],
    app,
    process.env
  );
  await ready(
    async () => {
      await mongo.connect();
      return true;
    },
    mongoProcess,
    'Temporary Mongo'
  );
  const safeEnv = {
    ...process.env,
    NEXT_PUBLIC_BASE_URL: platformBase,
    NEXT_PUBLIC_ROOT_DOMAIN: 'whataisle.com',
    STRIPE_SECRET_KEY: '',
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GEMINI_API_KEY: '',
    GOOGLE_CLOUD_PROJECT: 'local-fixture-no-network',
    OPENROUTER_API_KEY: '',
    GOOGLE_APPLICATION_CREDENTIALS: path.join(
      artifactDirectory,
      'no-cloud-credentials'
    ),
    WHEREBEAR_BACKGROUND_DISABLED: '1',
  };
  const platform = child(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(platformPort),
    ],
    root,
    { ...safeEnv, NODE_ENV: 'development', NEXT_DIST_DIR: distName }
  );
  const platformConfigUrl = `${platformBase}/api/runtime/store/${storeId}`;
  await ready(
    async () => {
      const response = await fetch(platformConfigUrl);
      return response.status === 401;
    },
    platform,
    'Platform Next'
  );
  let response = await fetch(platformConfigUrl, {
    headers: { Authorization: `Bearer ${runtimeToken}` },
  });
  assert.equal(response.status, 200);
  let actual = await response.json();
  assert.equal(actual.storeId, storeId);
  assert.equal(actual.pinVersion, 1);
  assert.equal(actual.accessAllowed, true);
  assert.equal(actual.searchReady, false);
  pass(
    'real platform authenticates only the hashed runtime token and returns active service'
  );
  const dataDir = path.join(artifactDirectory, 'store');
  const scanDir = path.join(dataDir, 'scan');
  const billingDir = path.join(dataDir, 'billing');
  const mcpDir = path.join(dataDir, 'mcp');
  await Promise.all(
    [scanDir, billingDir, mcpDir].map((dir) => mkdir(dir, { recursive: true }))
  );
  const runtime = child(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(storePort),
    ],
    app,
    {
      ...safeEnv,
      NODE_ENV: 'production',
      STORE_ID: storeId,
      STORE_CANONICAL_URL: `https://${handle}.whataisle.com`,
      WHATAISLE_PLATFORM_URL: platformBase,
      STORE_RUNTIME_TOKEN: runtimeToken,
      MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}`,
      MONGODB_DB: 'combined_store',
      SCAN_JOBS_DIR: scanDir,
      BILLING_JOURNAL_DIR: billingDir,
      MDB_MCP_LOG_PATH: mcpDir,
      ADMIN_WRITES: 'unlocked',
    }
  );
  await ready(
    async () => {
      const result = await fetch(`${runtimeBase}/api/runtime/health`);
      return result.ok;
    },
    runtime,
    'Store Next'
  );
  actual = await config();
  assert.equal(actual.storeId, storeId);
  assert.equal(actual.displayName, 'Combined original store');
  assert.equal(actual.map, null);
  assert.equal('pinHash' in actual, false);
  pass(
    'real runtime reads the real platform identity without exposing the PIN hash'
  );
  response = await request(`${runtimeBase}/api/store-map`, {
    pin: '123456',
    map,
  });
  assert.equal(response.status, 200);
  const oldStaff = cookie(response);
  pass(
    'platform-created scrypt PIN saves the runtime map before search activation'
  );
  actual = await config();
  assert.equal(actual.searchReady, false);
  assert.equal(actual.map.shelves[0].id, map.shelves[0].id);
  for (const route of [
    '/api/search',
    '/api/identify',
    '/api/voice',
    '/api/vision/jobs',
  ]) {
    response = await request(`${runtimeBase}${route}`, {}, oldStaff);
    assert.equal(
      response.status,
      409,
      `${route} must remain closed before activation`
    );
    assert.equal((await response.json()).code, 'store_preparing');
  }
  assert.equal(
    await mongo.db('combined_store').collection('scan_jobs').countDocuments(),
    0
  );
  pass(
    'actual platform map-only state blocks search and upload without accepting jobs'
  );

  // Atlas is outside this local fixture. Represent an authenticated worker's
  // successful completion in PostgreSQL; the real platform derives searchReady.
  const storedMap = await mongo
    .db('combined_store')
    .collection<{ _id: string }>('store_floor_map')
    .findOne({ _id: 'published' });
  await db
    .update(storeRuntime)
    .set({ kind: 'activate', status: 'ready' })
    .where(eq(storeRuntime.storeId, storeId));
  actual = await config();
  assert.equal(actual.searchReady, true);
  assert.deepEqual(
    await mongo
      .db('combined_store')
      .collection<{ _id: string }>('store_floor_map')
      .findOne({ _id: 'published' }),
    storedMap
  );
  response = await request(
    `${runtimeBase}/api/admin/products`,
    undefined,
    oldStaff
  );
  assert.equal(response.status, 200);
  pass(
    'real platform activation opens the existing staff session and preserves the map document'
  );
  const ownerUrl = await createOwnerMapEntry(ownerId);
  const ownerToken = new URL(ownerUrl).searchParams.get('owner_token');
  assert.ok(ownerToken);
  response = await request(`${runtimeBase}/api/runtime/owner-entry`, {
    token: ownerToken,
  });
  assert.equal(response.status, 200);
  const oldOwner = cookie(response);
  response = await request(`${runtimeBase}/api/runtime/owner-entry`, {
    token: ownerToken,
  });
  assert.equal(response.status, 403);
  pass('real owner grant exchanges across both servers exactly once');
  const edit = {
    ...map,
    revision: 1,
    shelves: [{ ...map.shelves[0], code: '冷柜 2', x: 300 }],
  };
  response = await request(
    `${runtimeBase}/api/store-map`,
    { map: edit },
    oldOwner
  );
  assert.equal(response.status, 200);
  assert.equal((await config()).map.shelves[0].id, map.shelves[0].id);
  pass(
    'platform-issued owner permission edits the runtime map without replacing shelf IDs'
  );
  const staleGrant = new URL(
    await createOwnerMapEntry(ownerId)
  ).searchParams.get('owner_token');
  await updateOwnerStore(ownerId, {
    displayName: 'Combined renamed store',
    pin: '234567',
  });
  actual = await config();
  assert.equal(actual.displayName, 'Combined renamed store');
  response = await request(
    `${runtimeBase}/api/admin/products`,
    undefined,
    oldStaff
  );
  assert.equal(response.status, 401);
  response = await request(
    `${runtimeBase}/api/store-map`,
    { map: { ...edit, revision: 2 } },
    oldOwner
  );
  assert.equal(response.status, 403);
  response = await request(`${runtimeBase}/api/runtime/owner-entry`, {
    token: staleGrant,
  });
  assert.equal(response.status, 403);
  pass(
    'real dashboard PIN change immediately revokes staff/owner sessions and unused older grants'
  );
  response = await request(`${runtimeBase}/api/staff/session`, {
    pin: '123456',
  });
  assert.equal(response.status, 401);
  response = await request(`${runtimeBase}/api/staff/session`, {
    pin: '234567',
  });
  assert.equal(response.status, 200);
  const newStaff = cookie(response);
  response = await request(
    `${runtimeBase}/api/admin/products`,
    undefined,
    newStaff
  );
  assert.equal(response.status, 200);
  pass('only the new platform PIN can issue a replacement staff session');
  await db
    .update(storeSubscription)
    .set({
      status: 'suspended',
      entitlementEnd: new Date(Date.now() - 86400_000),
      suspendedAt: new Date(),
      retentionUntil: new Date(Date.now() + 90 * 86400_000),
    })
    .where(eq(storeSubscription.ownerUserId, ownerId));
  actual = await config();
  assert.equal(actual.accessAllowed, false);
  assert.equal(actual.map, null);
  assert.ok(actual.recoveryUrl.endsWith('/dashboard'));
  for (const route of [
    '/api/search',
    '/api/identify',
    '/api/voice',
    '/api/vision/jobs',
  ]) {
    response = await request(`${runtimeBase}${route}`, {}, newStaff);
    assert.equal(response.status, 402);
  }
  await assert.rejects(createOwnerMapEntry(ownerId));
  pass(
    'real platform suspension immediately blocks shopper AI and staff work while retaining recovery'
  );
  const restoredStart = new Date();
  const restoredEnd = new Date(restoredStart.getTime() + 30 * 86400_000);
  await db
    .update(storeSubscription)
    .set({
      status: 'active',
      periodStart: restoredStart,
      entitlementEnd: restoredEnd,
      suspendedAt: null,
      retentionUntil: null,
    })
    .where(eq(storeSubscription.ownerUserId, ownerId));
  actual = await config();
  assert.equal(actual.accessAllowed, true);
  assert.equal(actual.map.revision, 2);
  assert.equal(actual.map.shelves[0].code, '冷柜 2');
  response = await request(
    `${runtimeBase}/api/admin/products`,
    undefined,
    newStaff
  );
  assert.equal(response.status, 200);
  const restoredToken = new URL(
    await createOwnerMapEntry(ownerId)
  ).searchParams.get('owner_token');
  response = await request(`${runtimeBase}/api/runtime/owner-entry`, {
    token: restoredToken,
  });
  assert.equal(response.status, 200);
  pass(
    'restored local billing service reopens the same runtime/map and owner entry without rebuilding data'
  );
  await db
    .update(storeRuntime)
    .set({ cleanupRequestedAt: new Date() })
    .where(eq(storeRuntime.storeId, storeId));
  actual = await config();
  assert.equal(actual.accessAllowed, false);
  response = await request(`${runtimeBase}/api/runtime/owner-entry`, {
    token: newSecret(),
  });
  assert.equal(response.status, 402);
  pass(
    'a founder cleanup request also shuts runtime access through the actual platform API'
  );
  await writeFile(
    path.join(artifactDirectory, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        fixtureOwner: ownerId,
        storeId,
        artifactDirectory,
        providerCalls: false,
      },
      null,
      2
    )
  );
  console.log(
    `Combined integration: ${checks}/${checks} checks passed. Artifacts: ${artifactDirectory}`
  );
} finally {
  for (const process of children.reverse()) process.kill('SIGTERM');
  await Promise.all(
    children.map(
      (process) =>
        new Promise<void>((resolve) => {
          if (process.exitCode !== null) return resolve();
          process.once('exit', () => resolve());
          setTimeout(resolve, 5000).unref();
        })
    )
  );
  await mongo.close();
  const ownStores = await db
    .select({ id: store.id })
    .from(store)
    .where(eq(store.ownerUserId, ownerId));
  const ids = ownStores.map((row) => row.id);
  if (ids.length) {
    await db
      .delete(storeOwnerEntry)
      .where(inArray(storeOwnerEntry.storeId, ids));
    await db.delete(storeRuntime).where(inArray(storeRuntime.storeId, ids));
    await db.delete(auditLog).where(inArray(auditLog.storeId, ids));
  }
  await db
    .delete(storeSubscription)
    .where(eq(storeSubscription.ownerUserId, ownerId));
  await db.delete(store).where(eq(store.ownerUserId, ownerId));
  await db.delete(user).where(eq(user.id, ownerId));
  await (
    db as unknown as {
      $client: { end: (options: { timeout: number }) => Promise<void> };
    }
  ).$client.end({ timeout: 5 });
  // Next automatically appends custom-dist type globs and rewrites next-env.
  // Remove only this fixture's additions; preserve any concurrent parent changes.
  const currentConfig = JSON.parse(await readFile(tsconfigFile, 'utf8'));
  currentConfig.include = (currentConfig.include as string[]).filter(
    (value) => !value.startsWith(`${distName}/`)
  );
  const originalConfig = JSON.parse(originalTsconfig);
  await writeFile(
    tsconfigFile,
    JSON.stringify(currentConfig) === JSON.stringify(originalConfig)
      ? originalTsconfig
      : `${JSON.stringify(currentConfig, null, 2)}\n`
  );
  const currentNextEnv = await readFile(nextEnvFile, 'utf8');
  if (currentNextEnv.includes(`./${distName}/`))
    await writeFile(nextEnvFile, originalNextEnv);
  try {
    await rename(
      path.join(root, distName),
      path.join(artifactDirectory, 'platform-cache')
    );
  } catch {}
  console.log(
    'Only this combined fixture was cleaned up; its servers stopped.'
  );
}
