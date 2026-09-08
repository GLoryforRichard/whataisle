import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./store-build-container.sh', import.meta.url)
);

test('container plan creates no files and needs neither Docker nor a Git checkout', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-build-plan-'));
  try {
    const output = path.join(base, 'output');
    const result = spawnSync('/bin/bash', [script, 'a'.repeat(40), output], {
      cwd: base,
      env: { PATH: '/nonexistent' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan only/);
    assert.deepEqual(fs.readdirSync(base), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('container invocation mounts one committed shallow snapshot read-only and a dedicated output only', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-build-snapshot-'));
  try {
    const source = path.join(base, 'source');
    const bin = path.join(base, 'bin');
    const output = path.join(base, 'output');
    const capture = path.join(base, 'docker.json');
    fs.mkdirSync(source);
    fs.mkdirSync(bin);
    const git = (...args) => {
      const result = spawnSync('git', ['-C', source, ...args], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '--quiet');
    fs.mkdirSync(path.join(source, 'scripts'));
    fs.mkdirSync(path.join(source, 'apps/wherebear'), { recursive: true });
    fs.writeFileSync(path.join(source, '.gitignore'), '.env\n');
    for (const name of [
      'scripts/store-build-release.sh',
      'scripts/store-build-platform.mjs',
      'apps/wherebear/package-lock.json',
    ])
      fs.writeFileSync(path.join(source, name), 'committed fixture\n');
    git('add', '.');
    const commit = () =>
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'fixture'
      );
    commit();
    commit();
    const sha = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(source, '.env'), 'FIXTURE_ONLY=untracked\n');
    fs.writeFileSync(path.join(source, 'uncommitted.txt'), 'excluded\n');
    fs.writeFileSync(
      path.join(source, 'apps/wherebear/package-lock.json'),
      'uncommitted edit\n'
    );
    fs.writeFileSync(
      path.join(bin, 'docker'),
      `#!${process.execPath}\nif (process.argv[2] === 'context') { console.log('unix:///fixture/docker.sock'); process.exit(0); }\nconst fs = require('node:fs'); fs.writeFileSync(process.env.BUILD_TEST_CAPTURE, JSON.stringify({args:process.argv.slice(2),stdin:fs.readFileSync(0,'utf8')}));\n`,
      { mode: 0o700 }
    );
    const result = spawnSync('/bin/bash', [script, sha, output, '--run'], {
      cwd: source,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: base,
        BUILD_TEST_CAPTURE: capture,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const invocation = JSON.parse(fs.readFileSync(capture, 'utf8'));
    const mounts = invocation.args.flatMap((value, index, args) =>
      value === '--mount' ? [args[index + 1]] : []
    );
    assert.equal(mounts.length, 2);
    assert.equal(mounts[1], `type=bind,src=${output},dst=/output`);
    assert.match(mounts[0], /source\.git,dst=\/source\.git,readonly$/);
    assert.ok(!mounts[0].includes(`src=${source},`));
    assert.ok(invocation.args.includes('linux/amd64'));
    assert.ok(
      invocation.args.some((arg) =>
        /^docker\.io\/library\/ubuntu:22\.04@sha256:[a-f0-9]{64}$/.test(arg)
      )
    );
    assert.ok(
      !invocation.args.some((arg) =>
        ['--env', '--env-file', '-e'].includes(arg)
      )
    );
    assert.match(invocation.stdin, /sha256sum --check --status/);
    const snapshot = mounts[0].split('src=')[1].split(',dst=')[0];
    const readSnapshot = (...args) => {
      const item = spawnSync('git', ['-C', snapshot, ...args], {
        encoding: 'utf8',
      });
      assert.equal(item.status, 0, item.stderr);
      return item.stdout.trim();
    };
    assert.equal(readSnapshot('rev-list', '--count', 'FETCH_HEAD'), '1');
    assert.equal(
      readSnapshot('show', `${sha}:apps/wherebear/package-lock.json`),
      'committed fixture'
    );
    assert.doesNotMatch(
      readSnapshot('ls-tree', '-r', '--name-only', sha),
      /(^|\n)(\.env|uncommitted\.txt)(\n|$)/
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
