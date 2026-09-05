import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStoreHost, canonicalLocation } from '../lib/store-identity.mjs';

test('dedicated deployment rejects other stores and attacker-controlled host suffixes', () => {
  for (const host of ['other.whataisle.com', 'www.whataisle.com', 'wherebear.whataisle.com.evil.test', null]) {
    assert.equal(classifyStoreHost(host), 'foreign');
  }
  assert.equal(classifyStoreHost('WHEREBEAR.WHATAISLE.COM:443'), 'canonical');
  assert.equal(classifyStoreHost('wherebear.help'), 'legacy');
  assert.equal(classifyStoreHost('www.wherebear.help'), 'legacy');
});
test('redirect retains deep links and query without accepting a new destination host', () => {
  assert.equal(canonicalLocation('/admin/queue', '?aisle=A1'), 'https://wherebear.whataisle.com/admin/queue?aisle=A1');
  assert.equal(new URL(canonicalLocation('//evil.test/path')).hostname, 'wherebear.whataisle.com');
});
