import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../lib/store-runtime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ legacy = false } = {}) {
  const state = { map: null, platformAvailable: true, config: {
    storeId: 'fixture-store', handle: 'fixture', displayName: 'Fixture',
    pinHash: `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`, pinVersion: 1,
    accessAllowed: true, setupAllowed: true, searchReady: false,
  } };
  const dependencies = {
    'server-only': {},
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    './store-identity.mjs': { STORE_ID: legacy ? 'wherebear' : 'fixture-store', CANONICAL_URL: 'https://fixture.whataisle.com', classifyStoreHost: () => 'canonical' },
    './mongodb': { getDb: () => assert.fail('Operational authorization must not mutate Mongo') },
    './runtime-paths.mjs': { runtimeDirectory: () => '/fixture' },
    './runtime-crypto.mjs': { verifyStoreSession: (value) => value === 'valid', verifyStorePin: () => false },
    './store-map': { getStoreMap: async () => state.map },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Response, URL, AbortSignal,
    process: { env: legacy ? {} : {
      STORE_RUNTIME_TOKEN: 't'.repeat(64), MONGODB_DB: 'fixture', MONGODB_URI: 'fixture',
      SCAN_JOBS_DIR: '/fixture', STORE_CANONICAL_URL: 'https://fixture.whataisle.com',
    } },
    fetch: async () => new Response(JSON.stringify(state.config), { status: state.platformAvailable ? 200 : 503 }),
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  const request = (route, staff = true) => ({
    url: `https://fixture.whataisle.com${route}`, method: 'POST',
    headers: new Headers({ host: 'fixture.whataisle.com', origin: 'https://fixture.whataisle.com' }),
    cookies: { get: () => staff ? { value: 'valid' } : undefined },
  });
  return { state, exports, request };
}

test('map and PIN routes remain delegated while all operational entry points wait for activation', async () => {
  const f = fixture();
  for (const route of ['/api/store-map', '/api/staff/session', '/api/runtime/owner-entry', '/api/runtime/config', '/api/runtime/health']) {
    assert.equal(await f.exports.authorizeStoreRequest(f.request(route)), null, route);
  }
  f.state.map = { revision: 1, shelves: [{ id: 'stable-shelf' }] };
  for (const route of ['/api/search', '/api/voice', '/api/identify', '/api/vision/jobs', '/api/vision/jobs/123', '/api/shelf-evidence', '/api/vision', '/api/admin/products', '/api/mcp-probe']) {
    const denied = await f.exports.authorizeStoreRequest(f.request(route));
    assert.equal(denied.status, 409, route);
    assert.equal((await denied.json()).code, 'store_preparing');
  }
  assert.equal((await f.exports.authorizeStoreRequest(f.request('/api/vision/jobs', false))).status, 401);
});

test('activation requires an explicit true flag, a saved map and live billing; withdrawal closes old sessions', async () => {
  const f = fixture();
  f.state.map = { revision: 4, shelves: [{ id: 'unchanged' }] };
  for (const value of [undefined, null, false, 'true', 1]) {
    f.state.config.searchReady = value;
    assert.equal((await f.exports.authorizeStoreRequest(f.request('/api/vision/jobs'))).status, 409);
  }
  f.state.config.searchReady = true;
  assert.equal(await f.exports.authorizeStoreRequest(f.request('/api/vision/jobs')), null);
  assert.equal(f.state.map.shelves[0].id, 'unchanged');
  f.state.map = null;
  assert.equal((await f.exports.authorizeStoreRequest(f.request('/api/vision/jobs'))).status, 409);
  f.state.config.accessAllowed = false;
  assert.equal((await f.exports.authorizeStoreRequest(f.request('/api/search'))).status, 402);
  f.state.platformAvailable = false;
  assert.equal((await f.exports.authorizeStoreRequest(f.request('/api/search'))).status, 503);
});

test('legacy WhereBear operation does not require the new activation flag or map document', async () => {
  const f = fixture({ legacy: true });
  assert.equal((await f.exports.getStoreRuntime()).searchReady, true);
  assert.equal(await f.exports.authorizeStoreRequest(f.request('/api/vision/jobs')), null);
});
