import { runtimeDirectory } from '../lib/runtime-paths.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashStorePin,
  verifyStorePin,
  signStoreSession,
  verifyStoreSession,
} from '../lib/runtime-crypto.mjs';
import { validateFloorMap, assertShelfContinuity } from '../lib/floor-map-model.mjs';
const secret = 'unit-test-session-secret-with-at-least-32-bytes';
const session = { storeId: 'shop-1', pinVersion: 1, role: 'staff', expiresAt: 20000 };
const map = {
  revision: 0,
  width: 1200,
  height: 900,
  shelves: [
    { id: 's_1234567890abcdef', code: 'A1', description: 'Drinks', x: 20, y: 20, w: 100, h: 60 },
  ],
};
test('six-digit store PIN is scrypt hashed; malformed hashes and wrong PINs fail closed', () => {
  const hash = hashStorePin('123456');
  assert.match(hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(verifyStorePin('123456', hash), true);
  for (const pin of ['12345', '1234567', '654321', '', 'abcdef'])
    assert.equal(verifyStorePin(pin, hash), false);
  for (const malformed of [null, 'scrypt$bad$bad', `${hash}$extra`, hash.slice(1)])
    assert.equal(verifyStorePin('123456', malformed), false);
  assert.throws(() => hashStorePin('1234'));
});
test('sessions cannot cross stores, PIN changes, roles, expiry, or signed data boundaries', () => {
  const token = signStoreSession(session, secret);
  const expected = { ...session, secret, now: 10000 };
  assert.equal(verifyStoreSession(token, expected), true);
  for (const override of [
    { storeId: 'shop-2' },
    { pinVersion: 2 },
    { role: 'owner' },
    { now: 20000 },
    { secret: 'different-secret-which-is-long-enough' },
  ])
    assert.equal(verifyStoreSession(token, { ...expected, ...override }), false);
  assert.equal(verifyStoreSession(`${token}x`, expected), false);
  assert.equal(verifyStoreSession(`${token}.extra`, expected), false);
  assert.throws(() => signStoreSession(session, '123456'));
});
test('moving or renaming a shelf retains its stable product association', () => {
  const original = validateFloorMap(map);
  const edited = validateFloorMap({
    ...map,
    revision: 1,
    shelves: [{ ...map.shelves[0], code: '冷柜 2', x: 400, y: 300 }],
  });
  assert.doesNotThrow(() => assertShelfContinuity(original, edited));
  assert.equal(original.shelves[0].id, edited.shelves[0].id);
  assert.throws(() => assertShelfContinuity(original, { ...edited, shelves: [] }));
});
test('map validator rejects collisions, unsafe labels, oversized documents and off-canvas geometry', () => {
  for (const input of [
    { ...map, shelves: [] },
    { ...map, width: 1 },
    { ...map, revision: -1 },
    { ...map, shelves: [map.shelves[0], map.shelves[0]] },
    ...[
      { code: '<script>' },
      { x: -1 },
      { w: Infinity },
      { x: 1190 },
      { id: '../../another-store' },
      { code: '   ' },
      { description: 'x'.repeat(121) },
    ].map((patch) => ({ ...map, shelves: [{ ...map.shelves[0], ...patch }] })),
  ])
    assert.throws(() => validateFloorMap(input));
  assert.throws(() =>
    validateFloorMap({
      ...map,
      shelves: [map.shelves[0], { ...map.shelves[0], id: 's_abcdef1234567890', code: 'a1' }],
    })
  );
});

test('managed runtimes never write scan files or MCP logs into a shared release',()=>{
 for(const key of ['SCAN_JOBS_DIR','MDB_MCP_LOG_PATH']) {
  assert.throws(()=>runtimeDirectory(key,{STORE_ID:'new-store'}));
  assert.throws(()=>runtimeDirectory(key,{STORE_ID:'new-store',[key]:'.shared'}));
  assert.equal(runtimeDirectory(key,{STORE_ID:'new-store',[key]:'/private/store-a/data'}),'/private/store-a/data');
 }
});
