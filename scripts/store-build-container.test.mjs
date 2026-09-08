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
const releaseScript = fileURLToPath(
  new URL('./store-build-release.sh', import.meta.url)
);
const prepareScript = fileURLToPath(
  new URL('./store-prepare-release.sh', import.meta.url)
);

function verifyArchive(archive, destination) {
  // Execute the installer's actual pre-extraction guard, without its VM checks,
  // extraction, permissions changes or activation. Keep one safety definition.
  const source = fs.readFileSync(prepareScript, 'utf8');
  const marker = 'python3 - "$store_archive" "$store_release" <<\'PY\'\n';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, 'Installer archive guard must be found');
  const end = source.indexOf('\nPY\n', start + marker.length);
  assert.ok(end > start, 'Installer archive guard must be complete');
  return spawnSync('python3', ['-', archive, destination], {
    input: source.slice(start + marker.length, end),
    encoding: 'utf8',
    timeout: 120000,
  });
}

// Offline final-artifact acceptance, including on macOS; never extracts it:
// node scripts/store-build-container.test.mjs --verify-archive /absolute/store.tgz
if (process.argv[2] === '--verify-archive') {
  const archive = process.argv[3];
  let base;
  try {
    assert.equal(process.argv.length, 4, 'One archive argument required');
    assert.ok(path.isAbsolute(archive), 'Absolute archive path required');
    assert.ok(fs.lstatSync(archive).isFile(), 'Regular archive required');
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-archive-accept-'));
    const result = verifyArchive(archive, path.join(base, 'uncreated-release'));
    const reasons = [
      'Archive special/hardlink refused',
      'Archive path escape refused',
      'Embedded environment file refused',
      'Archive symlink escape refused',
      'Duplicate archive path refused',
      'Archive entry traverses symlink',
    ];
    console.log(
      JSON.stringify({
        ok: result.status === 0,
        archive,
        reason:
          result.status === 0
            ? null
            : reasons.find((reason) => result.stderr?.includes(reason)) ||
              'Archive validation failed; raw diagnostic output suppressed',
      })
    );
    process.exitCode = result.status === 0 ? 0 : 1;
  } catch {
    console.error(
      'Archive validation failed; raw diagnostic output suppressed'
    );
    process.exitCode = 1;
  } finally {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  }
  process.exit(process.exitCode);
}

test('GNU tar release packaging expands real hardlinks and passes the actual installer archive guard', (t) => {
  const dockerImage = process.env.STORE_ARCHIVE_TEST_DOCKER_IMAGE;
  const gnuTar = ['tar', 'gtar'].find((binary) => {
    const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
    return version.status === 0 && version.stdout.includes('GNU tar');
  });
  if (!gnuTar && !dockerImage) {
    t.skip(
      'GNU tar required; macOS bsdtar is not a Linux packaging regression. Set STORE_ARCHIVE_TEST_DOCKER_IMAGE to an already cached local Ubuntu image.'
    );
    return;
  }
  if (dockerImage) {
    const context = spawnSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8' }
    );
    assert.equal(context.status, 0, 'A local Docker context is required');
    assert.ok(context.stdout.trim().startsWith('unix://'));
    assert.ok(
      !process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://')
    );
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-release-hardlinks-'));
  try {
    const source = path.join(base, 'source');
    const nativePaths = [
      'node_modules/ssh2/lib/protocol/crypto/build/Release/obj.target/sshcrypto.node',
      'node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node',
    ];
    for (const name of nativePaths)
      fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(
      path.join(source, nativePaths[0]),
      'native-output-fixture'
    );
    fs.linkSync(
      path.join(source, nativePaths[0]),
      path.join(source, nativePaths[1])
    );
    assert.equal(
      fs.statSync(path.join(source, nativePaths[0])).ino,
      fs.statSync(path.join(source, nativePaths[1])).ino
    );
    fs.mkdirSync(path.join(source, 'node_modules/.bin'), { recursive: true });
    fs.mkdirSync(path.join(source, 'node_modules/tool'), { recursive: true });
    fs.writeFileSync(path.join(source, 'node_modules/tool/cli.js'), 'fixture');
    fs.symlinkSync(
      '../tool/cli.js',
      path.join(source, 'node_modules/.bin/tool')
    );
    fs.mkdirSync(path.join(source, '.next/cache'), { recursive: true });
    fs.writeFileSync(path.join(source, '.next/cache/excluded'), 'cache');
    const command = fs
      .readFileSync(releaseScript, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('tar ') && line.includes('store_commit'));
    assert.ok(command, 'Use the production release packing command');
    assert.ok(command.includes('--hard-dereference'));
    const sha = 'a'.repeat(40);
    const pack = (name, packingCommand) => {
      const output = path.join(base, name);
      fs.mkdirSync(output);
      const input = `set -eu\nstore_build_dir="$1"\nstore_commit="$2"\n${dockerImage ? 'cd /fixture/source\ntar --version | head -n 1 | grep -q "GNU tar"' : 'tar() { command "$STORE_TEST_GNU_TAR" "$@"; }'}\n${packingCommand}\n`;
      const result = dockerImage
        ? spawnSync(
            'docker',
            [
              'run',
              '--rm',
              '-i',
              '--pull=never',
              '--network=none',
              '--cpus=1',
              '--memory=128m',
              '--read-only',
              '--mount',
              `type=bind,src=${base},dst=/fixture`,
              dockerImage,
              'bash',
              '-s',
              '--',
              `/fixture/${name}`,
              sha,
            ],
            { input, encoding: 'utf8', timeout: 30000 }
          )
        : spawnSync('/bin/bash', ['-s', '--', output, sha], {
            cwd: source,
            env: { ...process.env, STORE_TEST_GNU_TAR: gnuTar },
            input,
            encoding: 'utf8',
            timeout: 30000,
          });
      assert.equal(result.status, 0, result.stderr);
      const archive = path.join(output, `store-${sha}.tgz`);
      assert.ok(
        fs.statSync(archive).size > 0,
        'Packing must produce an archive'
      );
      return archive;
    };
    const oldArchive = pack('old', command.replace('--hard-dereference ', ''));
    const refused = verifyArchive(oldArchive, path.join(base, 'old-release'));
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Archive special\/hardlink refused/);
    const newArchive = pack('new', command);
    const accepted = verifyArchive(newArchive, path.join(base, 'new-release'));
    assert.equal(accepted.status, 0, accepted.stderr);
    const inspected = spawnSync('python3', ['-', newArchive, ...nativePaths], {
      input: `import sys, tarfile\nwith tarfile.open(sys.argv[1]) as archive:\n    members = {item.name.removeprefix('./'): item for item in archive.getmembers()}\n    for name in sys.argv[2:]:\n        assert members[name].isfile()\n        assert archive.extractfile(members[name]).read() == b'native-output-fixture'\n    assert members['node_modules/.bin/tool'].issym()\n    assert 'node_modules/tool/cli.js' in members\n    assert '.next/cache' in members\n    assert '.next/cache/excluded' not in members\n    assert not any(item.islnk() for item in members.values())\n`,
      encoding: 'utf8',
    });
    assert.equal(inspected.status, 0, inspected.stderr);
    t.diagnostic(
      dockerImage
        ? 'Verified with Linux GNU tar in a no-network local container'
        : 'Verified with local GNU tar'
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

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
