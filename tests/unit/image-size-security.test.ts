import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const fumadocsRequire = createRequire(
  realpathSync('node_modules/fumadocs-core/package.json')
);
const entry = fumadocsRequire.resolve('image-size');

// Run malformed images in a separate process: an unpatched parser blocks the
// event loop, so an in-process test timeout cannot stop the infinite loop.
for (const mode of ['cjs', 'esm']) {
  test(`image-size ${mode} rejects zero-length ICNS/JXL/HEIF entries`, () => {
    const moduleUrl = pathToFileURL(entry.replace(/\.cjs$/, '.mjs')).href;
    const script = `
      const assert = require('node:assert/strict');
      (async () => {
        const {imageSize} = ${mode === 'cjs' ? `require(${JSON.stringify(entry)})` : `await import(${JSON.stringify(moduleUrl)})`};
        const box = (name, payload = Buffer.alloc(0), size) => {
          const out = Buffer.alloc(8 + payload.length);
          out.writeUInt32BE(size ?? out.length); out.write(name, 4);
          payload.copy(out, 8); return out;
        };
        const icns = Buffer.alloc(16);
        icns.write('icns'); icns.writeUInt32BE(16, 4); icns.write('ic07', 8);
        assert.throws(() => imageSize(icns));
        const jxl = Buffer.concat([
          box('JXL ', Buffer.from([13,10,135,10])),
          box('ftyp', Buffer.from('jxl ')), box('jxlp', Buffer.alloc(4), 0),
        ]);
        assert.throws(() => imageSize(jxl));
        const heif = Buffer.concat([
          box('ftyp', Buffer.from('heic')),
          box('meta', Buffer.concat([Buffer.alloc(4),
            box('iprp', box('ipco', box('ispe', Buffer.alloc(12), 0))),
          ])),
        ]);
        assert.throws(() => imageSize(heif));
        const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
        assert.equal(imageSize(png).width, 1);
        const validIcns = Buffer.from(icns); validIcns.writeUInt32BE(8, 12);
        assert.equal(imageSize(validIcns).width, 128);
      })().catch(e => { console.error(e); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 5000,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  });
}
