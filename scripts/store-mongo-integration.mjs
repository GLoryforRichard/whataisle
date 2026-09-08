/** Real Mongo acceptance for provisioning's unique SKU index and scan upserts.
 * Uses a new, loopback-only authenticated mongod with isolated temporary data.
 * Run with Node 24: node scripts/store-mongo-integration.mjs
 * No existing Mongo URI, customer database, Atlas, AI or mail service is used.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProductIdentityIndex } from './store-provisioning-adapters.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../apps/wherebear');
const appRequire = createRequire(path.join(app, 'package.json'));
const { MongoClient } = appRequire('mongodb');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const products = Array.from({ length: 100 }, (_, i) => ({
  name: `Concurrent fixture SKU ${i}`,
  category: 'fixture',
}));

if (process.argv.includes('--scan-worker')) {
  // Use the actual store save pipeline, including its name normalization and
  // Mongo update operators. Alias enhancement is a separate function and is
  // deliberately not invoked: this test has no AI network dependency.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(
        specifier === 'server-only'
          ? appRequire.resolve('next/dist/compiled/server-only/empty.js')
          : specifier,
        context
      );
    },
  });
  const require = createRequire(import.meta.url);
  require('tsx/cjs');
  globalThis.fetch = async () => {
    throw new Error('External fetch is forbidden in this Mongo-only fixture');
  };
  try {
    const { saveShelfDirect } = appRequire('./lib/shelf-save.ts');
    let completed = false;
    for await (const event of saveShelfDirect({
      aisle: process.env.FIXTURE_SHELF,
      products,
    })) {
      assert.notEqual(
        event.type,
        'error',
        'The actual shelf save must succeed'
      );
      if (event.type === 'done') completed = true;
    }
    assert.equal(completed, true);
  } finally {
    await (await globalThis._mongoClientPromise)?.close();
  }
} else {
  const dir = await mkdtemp(path.join(tmpdir(), 'whataisle-mongo-index-'));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const endpoint = `mongodb://127.0.0.1:${port}`;
  const secret = randomBytes(24).toString('hex');
  const mongod = spawn(
    process.env.MONGOD_BINARY || '/opt/homebrew/bin/mongod',
    [
      '--dbpath',
      dir,
      '--port',
      String(port),
      '--bind_ip',
      '127.0.0.1',
      '--auth',
      '--quiet',
    ],
    { stdio: 'ignore' }
  );
  const children = [];
  let bootstrap;
  let admin;
  let restricted;
  let done = 0;
  const passed = (label) => console.log(`PASS ${++done}: ${label}`);
  try {
    bootstrap = new MongoClient(endpoint, { serverSelectionTimeoutMS: 300 });
    for (let attempt = 0; ; attempt++) {
      try {
        await bootstrap.connect();
        break;
      } catch {
        if (attempt >= 50 || mongod.exitCode !== null)
          throw new Error('Disposable Mongo did not start');
        await pause(100);
      }
    }
    await bootstrap.db('admin').command({
      createUser: 'fixture_admin',
      pwd: secret,
      roles: ['root'],
    });
    await bootstrap.close();
    admin = new MongoClient(
      `mongodb://fixture_admin:${secret}@127.0.0.1:${port}/admin`
    );
    await admin.connect();
    await admin.db('admin').command({
      createUser: 'fixture_store_a',
      pwd: secret,
      roles: [{ role: 'readWrite', db: 'fixture_store_a' }],
    });
    const uri = `mongodb://fixture_store_a:${secret}@127.0.0.1:${port}/fixture_store_a?authSource=admin`;
    restricted = new MongoClient(uri);
    const db = restricted.db('fixture_store_a');
    await db.createCollection('products');
    await ensureProductIdentityIndex(db.collection('products'));
    await ensureProductIdentityIndex(db.collection('products'));
    const index = (
      await db.collection('products').listIndexes().toArray()
    ).find((row) => row.name === 'name_key_unique');
    assert.equal(index.unique, true);
    passed(
      'single-store readWrite user creates and safely reuses the unique product index'
    );
    await admin
      .db('fixture_store_b')
      .collection('products')
      .insertOne({ protected: true });
    await assert.rejects(
      restricted.db('fixture_store_b').collection('products').findOne({}),
      { code: 13 }
    );
    passed('runtime credential cannot read the other store database');
    const shelves = ['s_aaaaaaaaaaaaaaaa', 's_bbbbbbbbbbbbbbbb'];
    const results = await Promise.all(
      shelves.map(
        (aisle) =>
          new Promise((resolve) => {
            const child = spawn(
              process.execPath,
              [fileURLToPath(import.meta.url), '--scan-worker'],
              {
                cwd: app,
                env: {
                  PATH: process.env.PATH,
                  NODE_ENV: 'development',
                  TSX_TSCONFIG_PATH: path.join(app, 'tsconfig.json'),
                  MONGODB_URI: uri,
                  MONGODB_DB: 'fixture_store_a',
                  STORE_ID: 'fixture-store-a',
                  GEMINI_API_KEY: 'fixture-only-no-network',
                  FIXTURE_SHELF: aisle,
                  WHEREBEAR_BACKGROUND_DISABLED: '1',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
              }
            );
            children.push(child);
            let details = '';
            child.stderr.on('data', (chunk) => {
              details += chunk.toString();
            });
            child.stdout.resume();
            child.once('error', () =>
              resolve({ code: -1, details: 'spawn failed' })
            );
            child.once('exit', (code) => resolve({ code, details }));
          })
      )
    );
    for (const result of results)
      assert.equal(
        result.code,
        0,
        `Actual scan worker failed: ${result.details.replaceAll(secret, '[redacted]').slice(-1500)}`
      );
    const rows = await db.collection('products').find({}).toArray();
    assert.equal(rows.length, products.length);
    for (const row of rows) {
      assert.deepEqual(row.aisles.sort(), shelves);
      assert.equal(row.evidence_count, 2);
      assert.deepEqual(Object.keys(row.aisle_seen).sort(), shelves);
    }
    assert.equal(await db.collection('shelf_evidence').countDocuments({}), 2);
    assert.equal(
      await admin
        .db('fixture_store_b')
        .collection('products')
        .countDocuments({ protected: true }),
      1
    );
    passed(
      'two real scan processes converge on 100 products and retain both shelf sightings'
    );
    await assert.rejects(
      db.collection('products').insertOne({ name_key: rows[0].name_key }),
      { code: 11000 }
    );
    passed('database rejects a duplicate normalized product key');
    console.log(
      `${done}/${done} real Mongo checks passed; only disposable local data was used.`
    );
  } finally {
    for (const child of children)
      if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.allSettled([
      bootstrap?.close(),
      admin?.close(),
      restricted?.close(),
    ]);
    if (mongod.exitCode === null) {
      mongod.kill('SIGTERM');
      await new Promise((resolve) => mongod.once('exit', resolve));
    }
    // Keep the uniquely generated local fixture files for inspection, matching
    // the project's preference to archive rather than recursively delete data.
  }
}
