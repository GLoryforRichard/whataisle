import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBuildPlatform,
  parseOsRelease,
} from './store-build-platform.mjs';

const target = {
  platform: 'linux',
  architecture: 'x64',
  node: '24.18.0',
  glibc: '2.35',
  os: { ID: 'ubuntu', VERSION_ID: '22.04' },
};

test('approved Ubuntu/glibc target records the exact native runtime boundary', () => {
  assert.deepEqual(assertBuildPlatform(target), {
    platform: 'linux',
    architecture: 'x64',
    osId: 'ubuntu',
    osVersion: '22.04',
    libc: 'glibc',
    glibcVersion: '2.35',
  });
});

test('Alpine reporting Linux x86_64 is refused because it has no glibc runtime', () => {
  assert.throws(
    () =>
      assertBuildPlatform({
        ...target,
        glibc: undefined,
        os: { ID: 'alpine', VERSION_ID: '3.24' },
      }),
    /MUSL_NOT_SUPPORTED/
  );
});

test('ARM, macOS, wrong Node and newer glibc cannot produce a VM release', () => {
  for (const mismatch of [
    { architecture: 'arm64' },
    { platform: 'darwin' },
    { node: '25.6.1' },
    { glibc: '2.36' },
    { glibc: '2.39', os: { ID: 'ubuntu', VERSION_ID: '24.04' } },
    { os: { ID: 'debian', VERSION_ID: '12' } },
  ])
    assert.throws(() => assertBuildPlatform({ ...target, ...mismatch }));
});

test('os-release is parsed as data without sourcing or executing shell text', () => {
  assert.deepEqual(
    parseOsRelease('ID=ubuntu\nVERSION_ID="22.04"\nOTHER="$(echo private)"\n'),
    target.os
  );
  const injected = parseOsRelease('ID="$(echo ubuntu)"\nVERSION_ID=22.04');
  assert.throws(() => assertBuildPlatform({ ...target, os: injected }));
});
