import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../lib/scan-queue/pump.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const drain = () => new Promise((resolve) => setImmediate(resolve));
function fixture(status = 'queued', respond = () => Response.json({ ok: true, jobId: 'job1', status: 'queued' }, { status: 202 })) {
  const record = { id: 'photo1', aisle: 'stable-shelf', blob: new Blob(['photo']), status, createdAt: Date.now(), attempts: 0, productsJson: status === 'detected' ? JSON.stringify([{ name: 'Milk' }]) : undefined };
  const outbox = new Map([[record.id, record]]), items = new Map(), calls = [];
  const dependencies = {
    './outbox': { outboxSupported: () => true, outboxListAll: async () => [...outbox.values()], outboxPut: async (row) => outbox.set(row.id, row), outboxUpdate: async (id, patch) => Object.assign(outbox.get(id) || {}, patch), outboxDelete: async (id) => outbox.delete(id) },
    './store': { getItems: () => [...items.values()], getItem: (id) => items.get(id), addItem: (row) => items.set(row.id, row), updateItem: (id, patch) => Object.assign(items.get(id) || {}, patch), removeItem: (id) => items.delete(id) },
    './prepare-photo': { preparePhoto: async (blob) => blob, reviveBlob: (blob) => blob },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Blob, FormData, TextDecoder, console,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    setTimeout: () => ({}), clearTimeout() {},
    fetch: async (url, options) => { calls.push({ url, options }); return respond(url, options); },
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return { exports, outbox, items, calls };
}

test('a restored offline photo stays local while preparing and submits once when operations open', async () => {
  const f = fixture();
  await f.exports.restoreFromOutbox(); await drain();
  assert.equal(f.calls.length, 0);
  assert.equal(f.outbox.size, 1);
  f.exports.setScanQueueEnabled(true); await drain();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/vision/jobs');
  assert.equal(f.items.get('photo1').jobId, 'job1');
  assert.equal(f.outbox.size, 1);
});

test('preparation rejection pauses an old tab without consuming attempts or dropping its photo', async () => {
  const f = fixture('queued', () => Response.json({ ok: false, code: 'store_preparing' }, { status: 409 }));
  await f.exports.restoreFromOutbox();
  f.exports.setScanQueueEnabled(true); await drain();
  assert.equal(f.calls.length, 1);
  assert.equal(f.items.get('photo1').status, 'queued');
  assert.equal(f.items.get('photo1').attempts, 0);
  assert.equal(f.outbox.size, 1);
});

test('a save finishing during a pause retains local bytes and never resubmits the confirmed result', async () => {
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const f = fixture('detected', () => response);
  await f.exports.restoreFromOutbox();
  f.exports.setScanQueueEnabled(true); await drain();
  assert.equal(f.calls.length, 1);
  f.exports.setScanQueueEnabled(false);
  finish(new Response('data: {"type":"done"}\n\n'));
  await drain();
  assert.equal(f.outbox.size, 1);
  assert.equal(f.items.get('photo1').status, 'saved');
  f.exports.setScanQueueEnabled(true); await drain();
  assert.equal(f.calls.length, 1);
  assert.equal(f.outbox.size, 0);
});
