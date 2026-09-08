#!/usr/bin/env python3
"""Install reviewed initial-store candidates, without starting/reloading services.

This is prepared operator code, not evidence of a production installation.
Run --review without privileges. --install and --rollback-before-start require
separate authorization, root on the approved VM, and a root-only staging bundle.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT = Path('/var/lib/whataisle-provisioning/bootstrap')
CADDY = Path('/etc/caddy/Caddyfile')
PLATFORM = Path('/etc/whataisle-platform/platform.env')
WORKER = Path('/etc/whataisle-provisioning/worker.json')
CURRENT = Path('/srv/whataisle-store/current')
RELEASES = Path('/srv/whataisle-store/releases')
STATE_DIRECTORY = Path('/var/lib/whataisle-provisioning/stores')
ROUTES = Path('/etc/caddy/whataisle-stores')
NODE = '/opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node'
EXPECTED_BUILD_PLATFORM = {
    'platform': 'linux', 'architecture': 'x64', 'osId': 'ubuntu',
    'osVersion': '22.04', 'libc': 'glibc', 'glibcVersion': '2.35',
}
ASSETS = {
    **{f'/opt/whataisle-provisioning/scripts/{name}': 0o750 for name in [
        'store-provisioning.mjs', 'store-provisioning-core.mjs',
        'store-provisioning-adapters.mjs']},
    **{f'/etc/systemd/system/{name}': 0o644 for name in [
        'whataisle-store@.service', 'whataisle-stores.slice',
        'whataisle-provisioning.service', 'whataisle-billing-reconcile.service',
        'whataisle-billing-reconcile.timer']},
}
INSTALL_DIRECTORIES = [
    (Path('/etc/whataisle-provisioning'), 0o700), (Path('/etc/whataisle-stores'), 0o700),
    (ROUTES, 0o755), (Path('/opt/whataisle-provisioning/scripts'), 0o755),
]


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def root_path(path, private=False):
    for entry in [*reversed(path.parents), path]:
        if not entry.exists() and not entry.is_symlink():
            continue
        stat = entry.lstat()
        need(not entry.is_symlink() and stat.st_uid == 0, 'Unsafe path ownership or symlink')
        need(stat.st_mode & 0o022 == 0, 'Writable path boundary refused')
    if private:
        need(path.stat().st_mode & 0o077 == 0, 'Private bundle permissions required')


def verify_vm():
    need(os.geteuid() == 0 and os.uname().sysname == 'Linux', 'Root on approved Linux VM required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def metadata(key):
        request = urllib.request.Request(
            'http://169.254.169.254/computeMetadata/v1/' + key,
            headers={'Metadata-Flavor': 'Google'})
        with opener.open(request, timeout=5) as response:
            return response.read().decode()
    need(metadata('project/project-id') == 'wherebear-prod-20260902', 'Wrong GCP project')
    need(metadata('instance/name') == 'wherebear-vm', 'Wrong VM')
    need(metadata('instance/zone').endswith('/northamerica-northeast2-b'), 'Wrong zone')


def load_bundle(directory):
    need(directory.parent == ROOT and re.fullmatch(r'\d+-[a-f0-9]{12}', directory.name), 'Unknown bootstrap directory')
    root_path(directory, private=True)
    root_path(directory / 'manifest.json', private=True)
    manifest = json.loads((directory / 'manifest.json').read_text())
    need(manifest.get('version') == 1 and re.fullmatch(r'[a-f0-9]{40}', manifest.get('releaseCommit', '')), 'Invalid manifest')
    need(len(manifest['assets']) == len(ASSETS), 'Unexpected asset count')
    need({asset['destination'] for asset in manifest['assets']} == set(ASSETS), 'Unexpected destination')
    candidates = [
        ('Caddyfile.before', 'caddyBefore'), ('Caddyfile.candidate', 'caddyAfter'),
        ('platform.env.before', 'platformBefore'), ('platform.env.candidate', 'platformAfter'),
        ('worker.json.candidate', 'workerDigest'),
    ]
    for name, key in candidates:
        root_path(directory / name, private=True)
        need(digest((directory / name).read_bytes()) == manifest[key], 'Candidate or backup changed')
    for asset in manifest['assets']:
        need(re.fullmatch(r'asset-\d+', asset['file']), 'Unsafe asset name')
        need(asset['mode'] == ASSETS[asset['destination']], 'Unexpected asset mode')
        root_path(directory / asset['file'], private=True)
        need(digest((directory / asset['file']).read_bytes()) == asset['digest'], 'Reviewed asset changed')
    return manifest


def write(path, data, mode):
    root_path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd, temporary = tempfile.mkstemp(prefix='.bootstrap-', dir=path.parent)
    with os.fdopen(fd, 'wb') as file:
        os.fchmod(file.fileno(), mode)
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


def pristine():
    for name in ['whataisle-provisioning.service', 'whataisle-billing-reconcile.service', 'whataisle-billing-reconcile.timer']:
        result = subprocess.run(['systemctl', 'is-active', '--quiet', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        need(result.returncode != 0, 'Stop and review new workers before rollback or installation')
    need(not list(STATE_DIRECTORY.glob('*.json')), 'Provisioning has started; preserve customer state and use the post-start recovery runbook')


def install(directory, manifest):
    pristine()
    release = RELEASES / manifest['releaseCommit']
    root_path(release)
    runtime = json.loads((release / 'store-runtime-manifest.json').read_text())
    need(runtime.get('commit') == manifest['releaseCommit'] and runtime.get('runtimeIdentity') == 'server-env-v1' and runtime.get('platformContract') == 'v1', 'Wrong prepared store release')
    need(runtime.get('buildPlatform') == EXPECTED_BUILD_PLATFORM and runtime.get('node') == '24.18.0', 'Unapproved store artifact native ABI')
    need((release / '.next/BUILD_ID').is_file() and (release / 'node_modules/next/dist/bin/next').is_file(), 'Incomplete Linux store build')
    need(subprocess.check_output([NODE, '--version'], text=True).strip() == 'v24.18.0', 'Wrong Node runtime')
    need(not CURRENT.exists() and not CURRENT.is_symlink(), 'Existing store release activation requires separate review')
    for destination in [*ASSETS, str(WORKER)]:
        need(not Path(destination).exists() and not Path(destination).is_symlink(), 'Initial-install target already exists')
    root_path(CADDY)
    root_path(PLATFORM)
    need(digest(CADDY.read_bytes()) == manifest['caddyBefore'], 'Caddy changed since staging')
    need(digest(PLATFORM.read_bytes()) == manifest['platformBefore'], 'Platform configuration changed since staging')
    need(not ROUTES.exists() or not list(ROUTES.iterdir()), 'Store routes already exist')
    for directory_path, mode in INSTALL_DIRECTORIES:
        root_path(directory_path)
        directory_path.mkdir(parents=True, exist_ok=True, mode=mode)
        os.chmod(directory_path, mode)
    # Validate the merged full config before modifying the live config file.
    result = subprocess.run(['caddy', 'validate', '--config', str(directory / 'Caddyfile.candidate'), '--adapter', 'caddyfile'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    need(result.returncode == 0, 'Merged Caddy configuration failed validation')
    for asset in manifest['assets']:
        write(Path(asset['destination']), (directory / asset['file']).read_bytes(), asset['mode'])
    write(WORKER, (directory / 'worker.json.candidate').read_bytes(), 0o600)
    CURRENT.symlink_to(release)
    write(PLATFORM, (directory / 'platform.env.candidate').read_bytes(), 0o600)
    write(CADDY, (directory / 'Caddyfile.candidate').read_bytes(), 0o644)
    print('Installed candidates on disk only. No daemon reload, service start, restart, Caddy reload, schema write or customer task was run.')


def rollback(directory, manifest):
    pristine()
    # Refuse to overwrite any unrelated change made after this installation.
    for active, before, after in [(CADDY, 'caddyBefore', 'caddyAfter'), (PLATFORM, 'platformBefore', 'platformAfter')]:
        root_path(active)
        need(digest(active.read_bytes()) in [manifest[before], manifest[after]], 'Configuration changed after bootstrap; manual merge required')
    owned = [(Path(asset['destination']), asset['digest']) for asset in manifest['assets']]
    owned.append((WORKER, manifest['workerDigest']))
    for active, expected in owned:
        if active.exists():
            root_path(active)
            need(digest(active.read_bytes()) == expected, 'Installed asset changed; do not remove it automatically')
    if CURRENT.is_symlink():
        need(CURRENT.readlink() == RELEASES / manifest['releaseCommit'], 'Store release changed')
    else:
        need(not CURRENT.exists(), 'Unexpected current path')
    withdrawn = directory / 'withdrawn'
    need(not withdrawn.exists(), 'Previous rollback archive already exists')
    withdrawn.mkdir(mode=0o700)
    for active, _ in owned:
        if active.exists():
            destination = withdrawn / str(active).lstrip('/')
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            active.rename(destination)
    if CURRENT.is_symlink():
        CURRENT.rename(withdrawn / 'store-current.symlink')
    write(PLATFORM, (directory / 'platform.env.before').read_bytes(), 0o600)
    write(CADDY, (directory / 'Caddyfile.before').read_bytes(), 0o644)
    print('Restored pre-install files and archived only new assets. No service was stopped, started, restarted or reloaded. Schema and customer data were not changed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', action='store_true')
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--install', type=Path)
    action.add_argument('--rollback-before-start', type=Path)
    args = parser.parse_args()
    if args.review or not (args.install or args.rollback_before_start):
        print('Installs only the reviewed new worker units/scripts/config, a new store current symlink, five platform Price IDs, test allowlist/token, and one appended Caddy import. It does not activate services, change the platform unit, touch WhereBear/PM2, migrate databases, or create cloud resources. See docs/STORE-BOOTSTRAP-REVIEW.md.')
    else:
        try:
            verify_vm()
            bundle = args.install or args.rollback_before_start
            manifest = load_bundle(bundle)
            (install if args.install else rollback)(bundle, manifest)
        except Exception:
            # No provider response, configuration contents or secret may escape.
            raise SystemExit('Bootstrap refused. Check the reviewed prerequisites and private bundle; inspect partial installation before retrying. No automatic rollback or service activation occurred.')
