import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  ProvisioningError,
  newState,
  validateJob,
  storePlan,
  validateState,
  sha256,
  caddyConfig,
  renderEnv,
  atlasUserBody,
  assertAtlasIsolation,
  mongoUri,
  provision,
  archive,
  searchIndexDefinitions,
} from './store-provisioning-core.mjs';
import {
  removeAtlasUser,
  routeInstall,
  requestJson,
  atlasClient,
  ensureAtlasUser,
  ensureProductIdentityIndex,
  ensureSearchIndexes,
  atomicWrite,
  readRestrictedJson,
  validateConfig,
} from './store-provisioning-adapters.mjs';

const job = {
  jobId: 'job-test-1',
  storeId: 'test-store-1',
  handle: 'teststore1',
  leaseToken: 'x'.repeat(48),
  leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
};
const config = {
  platformUrl: 'https://www.whataisle.com',
  workerId: 'wherebear-vm-1',
  workerToken: 'x'.repeat(48),
  atlasProjectId: 'a'.repeat(24),
  atlasClientId: 'test-client',
  atlasClientSecret: 'test-secret',
  atlasClusterName: 'shared-approved',
  atlasHost: 'cluster.example.mongodb.net',
  maxStores: 5,
  commonRuntimeEnv: { GOOGLE_CLOUD_PROJECT: 'wherebear-prod-20260902' },
};

function adapterFixture(options = {}) {
  const calls = [];
  const methods = [
    'credentials',
    'database',
    'filesystem',
    'runtime',
    'health',
    'routing',
    'publicHealth',
    'stop',
    'unroute',
    'cleanDatabase',
    'archiveFiles',
  ];
  const adapters = {
    runtimeVersion: 'a'.repeat(40),
    assertLease: async () => {
      if (options.leaseLost) throw new Error('lease lost');
    },
    save: async () => {},
    complete: async (payload) => {
      calls.push('complete');
      adapters.payload = payload;
    },
  };
  for (const name of methods)
    adapters[name] = async () => {
      calls.push(name);
      if (options.fail === name) throw new Error('injected failure');
    };
  return { adapters, calls };
}

test('immutable identity produces independent database, secret, queue, user, and route paths', () => {
  const first = storePlan(job);
  const second = storePlan(
    { ...job, storeId: 'test-store-2', handle: 'teststore2' },
    3102
  );
  for (const key of [
    'key',
    'dbName',
    'dbUser',
    'dataDir',
    'envFile',
    'stateFile',
    'osUser',
    'routeFile',
    'service',
    'canonicalUrl',
  ])
    assert.notEqual(first[key], second[key]);
  assert.equal(first.dbName.startsWith('wa_'), true);
  assert.equal(first.port, 3101);
});

test('path, hostname, port injection and existing WhereBear are rejected before side effects', () => {
  for (const handle of [
    'wherebear',
    'www',
    '../store',
    'store\nadmin.com',
    'evil.com',
    '-store',
    'store-',
    'a'.repeat(49),
  ])
    assert.throws(() => validateJob({ ...job, handle }));
  for (const storeId of ['wherebear', '../store', 'store/../../etc'])
    assert.throws(() => validateJob({ ...job, storeId }));
  for (const port of [3000, 3001, 3002, 3100, 3200, 3101.1, '3101'])
    assert.throws(() => storePlan(job, port));
});

test('retry state cannot change identity or reuse another store secrets', () => {
  const state = newState(job, 3101);
  assert.equal(validateState(state, job), state);
  assert.throws(() => validateState({ ...state, dbName: 'wherebear' }, job));
  assert.throws(() =>
    validateState(state, { ...job, storeId: 'another-store' })
  );
  assert.throws(() => validateState({ ...state, runtimeToken: 'weak' }, job));
  assert.notEqual(state.runtimeToken, state.sessionSecret);
  assert.equal(sha256(state.runtimeToken).length, 64);
});

test('Atlas user is restricted to exactly one store database and one approved cluster', () => {
  const state = newState(job, 3101);
  const body = atlasUserBody(state, config.atlasClusterName);
  assertAtlasIsolation(body, state, config.atlasClusterName);
  assert.throws(() =>
    assertAtlasIsolation(
      {
        ...body,
        roles: [
          ...body.roles,
          { roleName: 'readWriteAnyDatabase', databaseName: 'admin' },
        ],
      },
      state,
      config.atlasClusterName
    )
  );
  assert.throws(() =>
    assertAtlasIsolation(
      { ...body, scopes: [] },
      state,
      config.atlasClusterName
    )
  );
  assert.throws(() =>
    assertAtlasIsolation(
      {
        ...body,
        roles: [{ databaseName: 'wherebear', roleName: 'readWrite' }],
      },
      state,
      config.atlasClusterName
    )
  );
  assert.equal(
    new URL(mongoUri(state, config.atlasHost)).pathname,
    `/${state.dbName}`
  );
  assert.throws(() => mongoUri(state, 'example.com@evil.com'));
});

test('shared build uses runtime env and explicit bounded per-store directories', () => {
  const state = newState(job, 3101);
  const env = renderEnv(state, config);
  assert.match(
    env,
    /SCAN_JOBS_DIR="\/var\/lib\/whataisle-stores\/[a-f0-9]{24}\/scan-jobs"/
  );
  assert.match(env, /STORE_RUNTIME_TOKEN=/);
  assert.match(
    env,
    /MDB_MCP_LOG_PATH="\/var\/lib\/whataisle-stores\/[a-f0-9]{24}\/mcp-logs"/
  );
  assert.match(env, /WORKER_PHOTO_CONCURRENCY="1"/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_/);
  assert.throws(() =>
    renderEnv(state, {
      ...config,
      commonRuntimeEnv: { MONGODB_URI: 'shared-db' },
    })
  );
  assert.throws(() =>
    renderEnv(state, {
      ...config,
      commonRuntimeEnv: { GEMINI_API_KEY: 'secret\nINJECTED=value' },
    })
  );
  assert.doesNotMatch(caddyConfig(state), new RegExp(state.runtimeToken));
  assert.match(caddyConfig(state), /teststore1.whataisle.com/);
});

test('configuration refuses wrong projects and expanding MVP capacity automatically', () => {
  assert.equal(validateConfig(config), config);
  assert.throws(() =>
    validateConfig({ ...config, platformUrl: 'https://attacker.example' })
  );
  assert.throws(() =>
    validateConfig({
      ...config,
      commonRuntimeEnv: { GOOGLE_CLOUD_PROJECT: 'whataisle-prod' },
    })
  );
  assert.throws(() => validateConfig({ ...config, maxStores: 6 }));
  assert.throws(() => validateConfig({ ...config, atlasClientSecret: '' }));
});

test('provisioning waits for Mongo and identity checks before publishing or acknowledging', async () => {
  const state = newState(job, 3101);
  const { adapters, calls } = adapterFixture();
  await provision(job, state, adapters);
  assert.deepEqual(calls, [
    'credentials',
    'database',
    'filesystem',
    'runtime',
    'health',
    'routing',
    'publicHealth',
    'complete',
  ]);
  assert.equal(adapters.payload.runtimeTokenHash, sha256(state.runtimeToken));
  assert.equal(
    Object.values(adapters.payload).includes(state.runtimeToken),
    false
  );
});

test('failed stages retain stable secrets and retry reconciliation instead of trusting old markers', async () => {
  const state = newState(job, 3101);
  const token = state.runtimeToken;
  const failing = adapterFixture({ fail: 'health' });
  await assert.rejects(provision(job, state, failing.adapters));
  assert.equal(failing.calls.includes('routing'), false);
  assert.equal(failing.calls.includes('complete'), false);
  const retry = adapterFixture();
  await provision(job, state, retry.adapters);
  assert.equal(retry.calls[0], 'credentials');
  assert.equal(state.runtimeToken, token);
});

test('lease loss forbids all subsequent provisioning effects', async () => {
  const fixture = adapterFixture({ leaseLost: true });
  await assert.rejects(provision(job, newState(job, 3101), fixture.adapters));
  assert.deepEqual(fixture.calls, []);
});

test('archive requires write sources stopped, confirmed DB cleanup and file archive before completion', async () => {
  const state = newState(job, 3101);
  const fixture = adapterFixture();
  await archive({ ...job, kind: 'archive' }, state, fixture.adapters);
  assert.deepEqual(fixture.calls, [
    'stop',
    'unroute',
    'cleanDatabase',
    'archiveFiles',
    'complete',
  ]);
  assert.equal(fixture.adapters.payload.kind, 'archive');
  await assert.rejects(provision(job, state, fixture.adapters));
});

test('failed database cleanup must not acknowledge closure', async () => {
  const fixture = adapterFixture({ fail: 'cleanDatabase' });
  await assert.rejects(
    archive({ ...job, kind: 'archive' }, newState(job, 3101), fixture.adapters)
  );
  assert.equal(fixture.calls.includes('complete'), false);
  assert.equal(fixture.calls.includes('archiveFiles'), false);
});

test('indexes match runtime query names and automatic embedding field', () => {
  const [vector, text] = searchIndexDefinitions();
  assert.equal(vector.name, 'vector_index');
  assert.deepEqual(vector.definition.fields[0], {
    type: 'autoEmbed',
    path: 'search_text',
    modality: 'text',
    model: 'voyage-4',
  });
  assert.equal(text.name, 'text_index');
  assert.throws(() => searchIndexDefinitions('unreviewed-model'));
});

test('private state uses atomic 0600 files and refuses symlink destination', async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'store-provisioning-test-'))
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  await atomicWrite(file, '{"value":1}');
  assert.deepEqual(await readRestrictedJson(file), { value: 1 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await fs.symlink(file, path.join(dir, 'linked.json'));
  await assert.rejects(atomicWrite(path.join(dir, 'linked.json'), 'overwrite'));
  await fs.chmod(file, 0o644);
  await assert.rejects(readRestrictedJson(file));
});

test('dry-run is portable, has no secret generation, and makes no VM/network mutations', async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'store-plan-test-'))
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'job.json');
  await fs.writeFile(file, JSON.stringify(job));
  const result = spawnSync(
    process.execPath,
    ['scripts/store-provisioning.mjs', '--dry-run', '--job', file],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.plan.handle, 'teststore1');
  assert.doesNotMatch(result.stdout, /runtimeToken|dbPassword|leaseToken/);
  assert.deepEqual(await fs.readdir(dir), ['job.json']);
});

test('HTTP adapter rejects redirects and suppresses actual secret-bearing error bodies', async (t) => {
  let receivedRedirectTarget = false;
  const server = createServer((req, res) => {
    if (req.url === '/fail') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'mongodb://user:secret-password@example.net' })
      );
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/target' });
      res.end();
    } else if (req.url === '/target') {
      receivedRedirectTarget = true;
      res.end('{}');
    } else {
      res.writeHead(202);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(requestJson(`${base}/fail`), (error) => {
    assert.equal(error.code, 'HTTP_403');
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /secret-password|mongodb/);
    return true;
  });
  await assert.rejects(requestJson(`${base}/redirect`), {
    code: 'NETWORK_REQUEST_FAILED',
  });
  assert.equal(receivedRedirectTarget, false);
  assert.equal(await requestJson(`${base}/empty`, {}, [202]), null);
});

test('Atlas OAuth adapter uses short-lived bearer token and never sends client secret to data endpoint', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/api/oauth/token'))
      return new Response(
        JSON.stringify({
          access_token: 'temporary-access-token',
          expires_in: 3600,
        }),
        { status: 200 }
      );
    return new Response(JSON.stringify({ username: 'isolated-user' }), {
      status: 200,
    });
  });
  const atlas = atlasClient(config);
  await atlas('GET', 'databaseUsers/admin/test');
  await atlas('GET', 'databaseUsers/admin/test');
  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].options.headers.Authorization,
    `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`
  );
  assert.equal(requests[0].options.body, 'grant_type=client_credentials');
  for (const request of requests.slice(1)) {
    assert.equal(
      request.options.headers.Authorization,
      'Bearer temporary-access-token'
    );
    assert.equal(
      request.url.startsWith(
        `https://cloud.mongodb.com/api/atlas/v2/groups/${config.atlasProjectId}/`
      ),
      true
    );
    assert.doesNotMatch(JSON.stringify(request), /test-secret/);
  }
});

test('Atlas timed-out creation recovers by reading same user, without password rotation', async () => {
  const state = newState(job, 3101);
  const requests = [];
  let created = false;
  const adapter = async (method, route, body) => {
    requests.push({ method, route, body });
    if (method === 'GET') {
      if (!created) throw new ProvisioningError('HTTP_404');
      return atlasUserBody(state, config.atlasClusterName);
    }
    created = true;
    assert.equal(body.password, state.dbPassword);
    throw new ProvisioningError('NETWORK_REQUEST_FAILED');
  };
  await assert.rejects(ensureAtlasUser(state, config, adapter), {
    code: 'NETWORK_REQUEST_FAILED',
  });
  await ensureAtlasUser(state, config, adapter);
  assert.deepEqual(
    requests.map((entry) => entry.method),
    ['GET', 'POST', 'GET']
  );
});

test('Atlas duplicate-user response is inspected and broad grants never accepted', async () => {
  const state = newState(job, 3101);
  let reads = 0;
  await assert.rejects(
    ensureAtlasUser(state, config, async (method) => {
      if (method === 'GET' && ++reads === 1)
        throw new ProvisioningError('HTTP_404');
      if (method === 'POST') throw new ProvisioningError('HTTP_409');
      return {
        ...atlasUserBody(state, config.atlasClusterName),
        roles: [{ roleName: 'atlasAdmin', databaseName: 'admin' }],
      };
    }),
    { code: 'ATLAS_USER_ISOLATION_MISMATCH' }
  );
});

function indexFixture({
  existing = [],
  failCreate = false,
  terminal = 'READY',
} = {}) {
  const indexes = structuredClone(existing);
  let tick = 0;
  const mutations = [];
  const collection = {
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async (keys, options) => {
      assert.deepEqual(keys, { name_key: 1 });
      assert.equal(options.unique, true);
      mutations.push(options.name);
    },
    listSearchIndexes: () => ({
      toArray: async () =>
        indexes.map((index) => ({
          ...index,
          status: tick > 0 ? terminal : 'BUILDING',
          queryable: tick > 0 && terminal === 'READY',
        })),
    }),
    createSearchIndex: async (desired) => {
      mutations.push(desired.name);
      if (failCreate) throw new Error('permission denied');
      indexes.push({
        name: desired.name,
        type: desired.type,
        latestDefinition: desired.definition,
      });
    },
  };
  const db = {
    listCollections: () => ({ toArray: async () => [] }),
    createCollection: async (name) => {
      mutations.push(`collection:${name}`);
    },
    collection: (name) => {
      assert.equal(name, 'products');
      return collection;
    },
  };
  return {
    db,
    mutations,
    pause: async () => {
      tick++;
    },
    now: () => tick * 500_000,
  };
}

test('actual index adapter creates empty collection, waits for READY and leaves data unseeded', async () => {
  const f = indexFixture();
  await ensureSearchIndexes(f.db, undefined, async () => {}, f.pause, f.now);
  assert.deepEqual(f.mutations, [
    'collection:products',
    'name_key_unique',
    'vector_index',
    'text_index',
  ]);
});

test('product identity index rejects weaker existing constraints without rewriting customer data', async () => {
  for (const extra of [
    {},
    { unique: true, sparse: true },
    { unique: true, partialFilterExpression: { name_key: { $exists: true } } },
    { unique: true, collation: { locale: 'en', strength: 2 } },
  ]) {
    await assert.rejects(
      ensureProductIdentityIndex({
        listIndexes: () => ({
          toArray: async () => [{ key: { name_key: 1 }, ...extra }],
        }),
        createIndex: () => assert.fail('must not replace an existing index'),
      }),
      { code: 'PRODUCT_IDENTITY_INDEX_MISMATCH' }
    );
  }
  await ensureProductIdentityIndex({
    listIndexes: () => ({
      toArray: async () => [{ key: { name_key: 1 }, unique: true }],
    }),
    createIndex: () => assert.fail('equivalent unique index must be reused'),
  });
});

test('actual index adapter rejects denied permission, wrong model/type, failed build and timeout', async () => {
  const denied = indexFixture({ failCreate: true });
  await assert.rejects(
    ensureSearchIndexes(
      denied.db,
      undefined,
      async () => {},
      denied.pause,
      denied.now
    ),
    /permission denied/
  );
  for (const change of [
    { type: 'search' },
    {
      latestDefinition: {
        fields: [
          { type: 'autoEmbed', path: 'search_text', model: 'wrong-model' },
        ],
      },
    },
  ]) {
    const vector = searchIndexDefinitions()[0];
    const f = indexFixture({
      existing: [
        {
          name: vector.name,
          type: vector.type,
          latestDefinition: vector.definition,
          ...change,
        },
      ],
    });
    await assert.rejects(
      ensureSearchIndexes(f.db, undefined, async () => {}, f.pause, f.now),
      /SEARCH_INDEX_(TYPE|DEFINITION)_MISMATCH/
    );
  }
  for (const terminal of ['FAILED', 'BUILDING']) {
    const f = indexFixture({ terminal });
    await assert.rejects(
      ensureSearchIndexes(f.db, undefined, async () => {}, f.pause, f.now),
      /SEARCH_INDEX_(BUILD_FAILED|NOT_READY)/
    );
  }
});

test('actual index adapter performs no mutation after losing its lease', async () => {
  const f = indexFixture();
  await assert.rejects(
    ensureSearchIndexes(
      f.db,
      undefined,
      async () => {
        throw new Error('lease lost');
      },
      f.pause,
      f.now
    ),
    /lease lost/
  );
  assert.deepEqual(f.mutations, []);
});

test('Caddy adapter rolls back only its new fragment on validation failure and preserves unrelated routes', async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'store-caddy-test-'))
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mainFile = path.join(dir, 'Caddyfile');
  const original =
    'www.whataisle.com { reverse_proxy localhost:3000 }\nimport /etc/caddy/whataisle-stores/*.caddy\n';
  await fs.writeFile(mainFile, original);
  const state = {
    ...newState(job, 3101),
    routeFile: path.join(dir, 'new-store.caddy'),
  };
  const commands = [];
  await assert.rejects(
    routeInstall(state, {
      mainFile,
      command: async (command) => {
        commands.push(command);
        if (commands.length === 1)
          throw new ProvisioningError('COMMAND_FAILED_caddy');
      },
    }),
    { code: 'COMMAND_FAILED_caddy' }
  );
  await assert.rejects(fs.stat(state.routeFile), { code: 'ENOENT' });
  assert.equal(
    (await fs.readdir(dir)).some((name) =>
      name.startsWith('new-store.caddy.failed-')
    ),
    true
  );
  assert.equal(await fs.readFile(mainFile, 'utf8'), original);
  assert.deepEqual(commands, [
    '/usr/bin/caddy',
    '/usr/bin/caddy',
    '/usr/bin/systemctl',
  ]);
});

test('Caddy adapter rejects missing import and refuses to overwrite an existing different route', async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'store-caddy-conflict-'))
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mainFile = path.join(dir, 'Caddyfile');
  const state = {
    ...newState(job, 3101),
    routeFile: path.join(dir, 'store.caddy'),
  };
  await fs.writeFile(
    mainFile,
    'www.whataisle.com { reverse_proxy localhost:3000 }'
  );
  await assert.rejects(routeInstall(state, { mainFile }), {
    code: 'CADDY_IMPORT_NOT_INSTALLED',
  });
  await fs.writeFile(mainFile, 'import /etc/caddy/whataisle-stores/*.caddy\n');
  await fs.writeFile(state.routeFile, 'existing-route');
  await assert.rejects(routeInstall(state, { mainFile }), {
    code: 'EXISTING_ROUTE_MISMATCH',
  });
  assert.equal(await fs.readFile(state.routeFile, 'utf8'), 'existing-route');
});

test('Atlas cleanup waits for actual user absence rather than acknowledging HTTP 202', async () => {
  const state = newState(job, 3101);
  const methods = [];
  let reads = 0;
  let pauses = 0;
  await removeAtlasUser(
    state,
    config,
    async (method) => {
      methods.push(method);
      if (method === 'DELETE') return null;
      if (++reads >= 3) throw new ProvisioningError('HTTP_404');
      return atlasUserBody(state, config.atlasClusterName);
    },
    async () => {},
    async () => {
      pauses++;
    }
  );
  assert.deepEqual(methods, ['GET', 'DELETE', 'GET', 'GET']);
  assert.equal(pauses, 1);
});

test('Atlas cleanup refuses changed grants and unconfirmed asynchronous removal', async () => {
  const state = newState(job, 3101);
  await assert.rejects(
    removeAtlasUser(
      state,
      config,
      async () => ({
        ...atlasUserBody(state, config.atlasClusterName),
        roles: [],
      }),
      async () => {},
      async () => {}
    ),
    { code: 'ATLAS_USER_ISOLATION_MISMATCH' }
  );
  await assert.rejects(
    removeAtlasUser(
      state,
      config,
      async (method) =>
        method === 'DELETE'
          ? null
          : atlasUserBody(state, config.atlasClusterName),
      async () => {},
      async () => {}
    ),
    { code: 'ATLAS_USER_REMOVAL_NOT_CONFIRMED' }
  );
});
