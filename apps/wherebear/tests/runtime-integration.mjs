/** Disposable integration fixture: runs the built app twice against a fresh local Mongo.
 * No production credentials, AI calls, Stripe calls, or shared database writes.
 * Run: WHEREBEAR_BACKGROUND_DISABLED=1 npm run build && node tests/runtime-integration.mjs
 * KEEP_RUNTIME_FIXTURE=1 leaves only these test processes live for a manual browser walkthrough.
 */
import assert from 'node:assert/strict';
import { createServer, request as rawHttpRequest } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { hashStorePin } from '../lib/runtime-crypto.mjs';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(tmpdir(), 'whataisle-runtime-test-'));
const children = [];
let mongo;
let platform;
let done = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = tcpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const p = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return p;
}
function child(command, args, env) {
  const process = spawn(command, args, { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(process);
  let log = '';
  process.stdout.on('data', (d) => (log = (log + d).slice(-6000)));
  process.stderr.on('data', (d) => (log = (log + d).slice(-6000)));
  process.testLog = () => log;
  return process;
}
async function ready(check, process) {
  for (let i = 0; i < 100; i++) {
    if (process?.exitCode !== null && process?.exitCode !== undefined)
      throw new Error(`Test process exited (${process.exitCode})`);
    try {
      if (await check()) return;
    } catch {}
    await delay(200);
  }
  throw new Error('Test process did not become ready');
}
function passed(label) {
  done++;
  console.log(`PASS ${label}`);
}
const stores = {};
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
async function stop() {
  for (const process of children.reverse()) process.kill('SIGTERM');
  await Promise.all(
    children.map(
      (process) =>
        new Promise((resolve) => {
          if (process.exitCode !== null) return resolve();
          process.once('exit', resolve);
          setTimeout(resolve, 5000).unref();
        })
    )
  );
  await mongo?.close();
  await new Promise((resolve) => (platform ? platform.close(resolve) : resolve()));
}
try {
  const mongoPort = await port();
  const mongoDir = path.join(root, 'mongo');
  await mkdir(mongoDir);
  const mongod = child(
    process.env.MONGOD_BINARY || '/opt/homebrew/bin/mongod',
    ['--dbpath', mongoDir, '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--quiet'],
    process.env
  );
  mongo = new MongoClient(`mongodb://127.0.0.1:${mongoPort}`, { serverSelectionTimeoutMS: 500 });
  await ready(async () => {
    await mongo.connect();
    return true;
  }, mongod);
  platform = createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/runtime\/store\/([^/]+)(\/owner-entry)?$/);
    const store = match && stores[match[1]];
    if (!store || req.headers.authorization !== `Bearer ${store.token}`)
      return json(res, 401, { error: 'unauthorized' });
    if (store.unavailable) return json(res, 503, { error: 'unavailable' });
    if (match[2]) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (data.token !== store.ownerToken || store.ownerUsed)
        return json(res, 403, { allowed: false });
      store.ownerUsed = true;
      return json(res, 200, { allowed: true, pinVersion: store.config.pinVersion });
    }
    return json(res, 200, store.config);
  });
  await new Promise((resolve) => platform.listen(0, '127.0.0.1', resolve));
  const platformUrl = `http://127.0.0.1:${platform.address().port}`;
  for (const handle of ['runtimea', 'runtimeb']) {
    const id = `fixture-${handle}`;
    const runtimePort = await port();
    const token = randomBytes(32).toString('hex');
    const scanDir = path.join(root, handle, 'scan-jobs');
    await mkdir(scanDir, { recursive: true });
    await mkdir(path.join(root,handle,'mongo-mcp'),{recursive:true});
    const store = (stores[id] = {
      id,
      base: `http://localhost:${runtimePort}`,
      token,
      ownerToken: randomBytes(24).toString('hex'),
      ownerUsed: false,
      config: {
        storeId: id,
        handle,
        displayName: `Test ${handle}`,
        pinHash: hashStorePin('123456'),
        pinVersion: 1,
        accessAllowed: true,
        setupAllowed: true,
        serviceEndsAt: null,
        recoveryUrl: `${platformUrl}/owner`,
      },
    });
    store.db = mongo.db(handle);
    store.process = child(
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
        ...process.env,
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
        NODE_ENV: 'production',
        WHEREBEAR_BACKGROUND_DISABLED: '1',
        STORE_ID: id,
        STORE_CANONICAL_URL: `https://${handle}.whataisle.com`,
        WHATAISLE_PLATFORM_URL: platformUrl,
        STORE_RUNTIME_TOKEN: token,
        MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}`,
        MONGODB_DB: handle,
        SCAN_JOBS_DIR: scanDir,
        ADMIN_WRITES: 'unlocked',
        // Never inherit an external AI/billing credential into this fixture.
        GEMINI_API_KEY: '',
        GOOGLE_CLOUD_PROJECT: 'local-fixture-no-network',
        GOOGLE_APPLICATION_CREDENTIALS: path.join(root, 'no-cloud-credentials'),
        MDB_MCP_LOG_PATH:path.join(root,handle,'mongo-mcp'),
      }
    );
    await ready(async () => {
      const response = await fetch(`${store.base}/api/runtime/health`);
      return response.ok;
    }, store.process);
  }
  const [a, b] = Object.values(stores);
  const mcpClient=new Client({name:'store-runtime-local-test',version:'1.0.0'});
  const mcpTransport=new StdioClientTransport({command:process.execPath,args:[path.join(app,'node_modules/mongodb-mcp-server/dist/esm/index.js')],env:{PATH:process.env.PATH,HOME:root,MDB_MCP_CONNECTION_STRING:`mongodb://127.0.0.1:${mongoPort}`,MDB_MCP_LOG_PATH:path.join(root,'runtimea','mongo-mcp'),MDB_MCP_TELEMETRY:'disabled'},stderr:'pipe'});
  try {await mcpClient.connect(mcpTransport);const result=await mcpClient.listTools();assert.ok(result.tools.length>0);passed('the real Mongo MCP subprocess starts with a writable per-store log path without AI');}finally{await mcpClient.close();}

  async function request(store, path, body, { cookie, method = 'POST', headers = {} } = {}) {
    return fetch(`${store.base}${path}`, {
      method,
      headers: {
        Origin: store.base,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  }
  const get = async (store, path) => fetch(`${store.base}${path}`);
  const cookie = (response) => response.headers.get('set-cookie')?.split(';')[0];
  let response = await get(a, '/api/runtime/config');
  let config = await response.json();
  assert.equal(config.map, null);
  assert.equal(config.displayName, 'Test runtimea');
  assert.equal('pinHash' in config, false);
  assert.equal(JSON.stringify(config).includes(a.token), false);
  passed('new store has an empty map and no public credentials');
  assert.equal((await request(a, '/api/search', {})).status, 409);
  passed('an unconfirmed store cannot trigger paid search or AI inputs');
  const crossHostStatus = await new Promise((resolve, reject) => {
    const req = rawHttpRequest(
      `${a.base}/api/runtime/config`,
      { headers: { Host: 'runtimeb.whataisle.com' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(crossHostStatus, 421);
  passed('runtime A rejects store B host before any tenant access');
  for(const route of ['/cost-lab','/compare','/vision-test','/sample-shelf.jpg','/cost-lab-results/index.json'])assert.equal((await get(a,route)).status,404);passed('new stores cannot expose WhereBear sample photos or shared experiment artifacts');
  for (const endpoint of [
    '/api/vision/jobs',
    '/api/shelf-evidence',
    '/api/admin/products',
    '/api/search/feedback',
  ])
    assert.equal((await request(a, endpoint, {})).status, 401);
  passed('upload, scan-save and admin writes reject direct unauthenticated requests');
  const map = {
    revision: 0,
    width: 1200,
    height: 900,
    shelves: [
      { id: 's_1234567890abcdef', code: 'A1', description: 'Drinks', x: 40, y: 40, w: 160, h: 80 },
    ],
  };
  response = await request(a, '/api/store-map', { map, pin: '654321' });
  assert.equal(response.status, 401);
  assert.equal(await a.db.collection('store_floor_map').countDocuments(), 0);
  passed('wrong setup PIN cannot save map or open store');
  response = await request(a, '/api/store-map', { map, pin: '123456' });
  assert.equal(response.status, 200);
  const staff = cookie(response);
  config = await (await get(a, '/api/runtime/config')).json();
  assert.equal(config.map.shelves[0].id, map.shelves[0].id);
  assert.equal((await (await get(b, '/api/runtime/config')).json()).map, null);
  passed('correct confirmation atomically opens only the paid store and issues a staff session');
  response = await request(b, '/api/vision/jobs', {}, { cookie: staff });
  assert.equal(response.status, 401);
  passed('copying store A staff cookie into B never grants B access');
  response = await request(
    a,
    '/api/store-map',
    { map: { ...map, revision: 1 }, pin: '123456' },
    { cookie: staff }
  );
  assert.equal(response.status, 403);
  passed('a staff PIN/session cannot edit an already opened map');
  const photo = new FormData();
  photo.set('aisle', map.shelves[0].id);
  photo.set(
    'image',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
          'base64'
        ),
      ],
      { type: 'image/png' }
    ),
    'fixture.png'
  );
  response = await request(a, '/api/vision/jobs', photo, { cookie: staff });
  assert.equal(response.status, 202);
  assert.equal(await a.db.collection('scan_jobs').countDocuments(), 1);
  assert.equal(await b.db.collection('scan_jobs').countDocuments(), 0);
  passed('authenticated photo reaches only its own store queue without an AI call');
  const invalid = new FormData();
  invalid.set('aisle', 'B10');
  invalid.set('image', new Blob(['x'], { type: 'image/png' }), 'fixture.png');
  response = await request(a, '/api/vision/jobs', invalid, { cookie: staff });
  assert.equal(response.status, 400);
  passed('new stores cannot upload against a hardcoded WhereBear shelf');
  await a.db
    .collection('products')
    .insertOne({
      canonical_name: 'Fixture milk',
      latest_aisle: map.shelves[0].id,
      aisles: [map.shelves[0].id],
    });
  response = await request(a, '/api/runtime/owner-entry', { token: a.ownerToken });
  assert.equal(response.status, 200);
  const owner = cookie(response);
  response = await request(a, '/api/runtime/owner-entry', { token: a.ownerToken });
  assert.equal(response.status, 403);
  passed('owner dashboard map link exchanges exactly once');
  const renamed = { ...map, revision: 1, shelves: [{ ...map.shelves[0], code: '冷柜 2', x: 400 }] };
  response = await request(a, '/api/store-map', { map: renamed }, { cookie: owner });
  assert.equal(response.status, 200);
  assert.equal(
    (await a.db.collection('products').findOne({ canonical_name: 'Fixture milk' })).latest_aisle,
    map.shelves[0].id
  );
  passed('owner can move/rename a shelf while product associations retain their stable ID');
  response = await request(a, '/api/store-map', { map: renamed }, { cookie: owner });
  assert.equal(response.status, 409);
  passed('stale map revisions cannot overwrite a more recent edit');
  a.config.pinVersion = 2;
  a.config.pinHash = hashStorePin('234567');
  response = await request(a, '/api/vision/jobs', photo, { cookie: staff });
  assert.equal(response.status, 401);
  response = await request(
    a,
    '/api/store-map',
    { map: { ...renamed, revision: 2 } },
    { cookie: owner }
  );
  assert.equal(response.status, 403);
  passed('changing PIN invalidates staff and owner sessions immediately');
  a.config.accessAllowed = false;
  for (const endpoint of ['/api/search', '/api/identify', '/api/voice', '/api/vision/jobs'])
    assert.equal((await request(a, endpoint, {})).status, 402);
  config = await (await get(a, '/api/runtime/config')).json();
  assert.equal(config.accessAllowed, false);
  assert.equal(config.recoveryUrl, a.config.recoveryUrl);
  assert.equal(config.map, null);
  passed(
    'suspension blocks public search, AI input and staff scanning while retaining recovery link'
  );
  a.config.accessAllowed = true;
  a.unavailable = true;
  assert.equal((await request(a, '/api/search', {})).status, 503);
  a.unavailable = false;
  passed('a broken platform configuration fails closed before search or scanning');
  for (let i = 0; i < 11; i++)
    response = await request(
      a,
      '/api/staff/session',
      { pin: '000000' },
      { headers: { 'X-Forwarded-For': `10.0.0.${i}` } }
    );
  assert.equal(response.status, 429);
  passed('PIN guessing is capped across spoofed client IP addresses');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { ok: true, checks: done, storeA: a.base, storeB: b.base, artifactDirectory: root },
      null,
      2
    )
  );
  console.log(`Verified ${done} integration checks; artifacts: ${root}`);
  if (process.env.KEEP_RUNTIME_FIXTURE === '1') {
    console.log(`Browser fixture (fresh canvas): ${b.base}`);
    console.log(`Browser fixture (opened store): ${a.base}`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  await stop();
}
