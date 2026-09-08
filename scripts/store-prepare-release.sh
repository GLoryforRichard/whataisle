#!/usr/bin/env bash
# Root-only prepare on the approved VM. Never activates/restarts a runtime.
set -euo pipefail
umask 077
if [[ $# != 3 ]]; then
  echo 'Usage: store-prepare-release.sh FULL_COMMIT_SHA ABSOLUTE_TGZ EXPECTED_SHA256' >&2
  exit 2
fi
store_commit="$1"
store_archive="$2"
store_digest="$3"
[[ "$store_commit" =~ ^[0-9a-f]{40}$ && "$store_digest" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid commit/digest' >&2; exit 2; }
[[ "$store_archive" == /* && -f "$store_archive" && ! -L "$store_archive" ]] || { echo 'Archive must be an absolute regular file' >&2; exit 2; }
[[ "$EUID" == 0 && "$(uname -s)" == Linux ]] || { echo 'Root on approved Linux VM required' >&2; exit 2; }
store_metadata() {
  curl --fail --silent --show-error --max-time 5 -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"
}
[[ "$(store_metadata project/project-id)" == wherebear-prod-20260902 ]] || { echo 'Wrong GCP project' >&2; exit 2; }
[[ "$(store_metadata instance/name)" == wherebear-vm ]] || { echo 'Wrong VM' >&2; exit 2; }
[[ "$(store_metadata instance/zone)" == */northamerica-northeast2-b ]] || { echo 'Wrong zone' >&2; exit 2; }
[[ "$(sha256sum "$store_archive" | cut -d ' ' -f 1)" == "$store_digest" ]] || { echo 'Archive checksum mismatch' >&2; exit 2; }
store_release="/srv/whataisle-store/releases/$store_commit"
# Validate all tar entries before extracting any. Reject credential-like files,
# hard links, special files and links escaping the release; symlinks internal
# to node_modules (for npm executables) remain allowed.
python3 - "$store_archive" "$store_release" <<'PY'
import os, sys, tarfile, posixpath
archive, destination = sys.argv[1:]
for parent in ['/srv', '/srv/whataisle-store', '/srv/whataisle-store/releases']:
    if os.path.islink(parent): raise SystemExit('Symlink release parent refused')
    if os.path.exists(parent):
        st = os.stat(parent)
        if st.st_uid != 0 or st.st_mode & 0o022: raise SystemExit('Unsafe release parent permissions')
if os.path.lexists(destination): raise SystemExit('Existing release refused; inspect failed preparation separately')
with tarfile.open(archive) as tf:
    members = tf.getmembers()
    by_name = {}
    for item in members:
        name = posixpath.normpath(item.name)
        if item.name.startswith('/') or name == '..' or name.startswith('../'):
            raise SystemExit('Archive path escape refused')
        if not (item.isfile() or item.isdir() or item.issym()): raise SystemExit('Archive special/hardlink refused')
        if any(part == '.env' or part.startswith('.env.') and part not in ['.env.example'] for part in name.split('/')):
            raise SystemExit('Embedded environment file refused')
        if item.issym():
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname))
            if item.linkname.startswith('/') or target == '..' or target.startswith('../'): raise SystemExit('Archive symlink escape refused')
        if name in by_name: raise SystemExit('Duplicate archive path refused')
        by_name[name] = item
    for name, item in by_name.items():
        parent = posixpath.dirname(name)
        while parent and parent != '.':
            if parent in by_name and by_name[parent].issym(): raise SystemExit('Archive entry traverses symlink')
            parent = posixpath.dirname(parent)
PY
install -d -m 0755 /srv/whataisle-store /srv/whataisle-store/releases
mkdir -m 0755 "$store_release"
tar --no-same-owner --no-same-permissions -xzf "$store_archive" -C "$store_release"
chmod -R go-w "$store_release"
# Build staging is private; release contents must be readable to isolated users.
find "$store_release" -type d -exec chmod 0755 {} +
find "$store_release" -type f -exec chmod a+r {} +
python3 - "$store_release" "$store_commit" <<'PY'
import json, os, subprocess, sys
root, commit = sys.argv[1:]
with open(root + '/store-runtime-manifest.json') as file: manifest = json.load(file)
if manifest.get('commit') != commit or manifest.get('runtimeIdentity') != 'server-env-v1' or manifest.get('platformContract') != 'v1': raise SystemExit('Invalid runtime manifest')
expected_platform = {'platform':'linux','architecture':'x64','osId':'ubuntu','osVersion':'22.04','libc':'glibc','glibcVersion':'2.35'}
if manifest.get('buildPlatform') != expected_platform or manifest.get('node') != '24.18.0': raise SystemExit('Artifact native platform/ABI is not approved')
node = '/opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node'
runtime = json.loads(subprocess.check_output([node, '-p', 'JSON.stringify({platform:process.platform,architecture:process.arch,node:process.versions.node,glibc:process.report.getReport().header.glibcVersionRuntime})'], text=True))
if runtime != {'platform':'linux','architecture':'x64','node':'24.18.0','glibc':'2.35'}: raise SystemExit('Target native platform/ABI changed; review required')
os_release = {}
with open('/etc/os-release') as file:
    for line in file:
        key, separator, value = line.strip().partition('=')
        if separator and key in ['ID','VERSION_ID']: os_release[key] = value.strip('"\'')
if os_release != {'ID':'ubuntu','VERSION_ID':'22.04'}: raise SystemExit('Target distribution changed; review required')
for name in ['.next/BUILD_ID', '.next/cache', 'node_modules/next/dist/bin/next']:
    if not os.path.exists(root + '/' + name): raise SystemExit('Incomplete store release')
PY
echo 'Release prepared. Current symlink, running stores, Caddy, and databases were not changed.'
