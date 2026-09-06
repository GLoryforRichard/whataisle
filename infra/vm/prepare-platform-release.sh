#!/usr/bin/env bash
# Prepare only: never starts a service, edits current, or touches Wherebear.
set -euo pipefail
umask 027
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || die 'Usage: prepare-platform-release.sh COMMIT ARCHIVE SHA256'
commit=$1
archive=$2
digest=$3
[[ $commit =~ ^[0-9a-f]{40}$ ]] || die 'COMMIT must be a full lowercase Git SHA.'
[[ $digest =~ ^[0-9a-f]{64}$ ]] || die 'SHA256 must be lowercase hex.'
[[ $archive == /* && -f $archive && ! -L $archive ]] || die 'Use an absolute regular archive path.'
[[ $EUID == 0 ]] || die 'Run as root on the approved VM.'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'Requires Linux x86_64.'
for tool in curl sha256sum python3 flock; do command -v "$tool" >/dev/null || die "Missing $tool"; done
metadata() { curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 5 -H 'Metadata-Flavor: Google' "http://169.254.169.254/computeMetadata/v1/$1"; }
[[ $(metadata project/project-id) == wherebear-prod-20260902 ]] || die 'Wrong GCP project.'
[[ $(metadata instance/name) == wherebear-vm ]] || die 'Wrong GCE instance.'
[[ $(metadata instance/zone) == */zones/northamerica-northeast2-b ]] || die 'Wrong GCE zone.'
[[ $(sha256sum "$archive" | cut -d ' ' -f 1) == "$digest" ]] || die 'Archive digest mismatch.'
id whataisle-platform >/dev/null 2>&1 || die 'Provision whataisle-platform user first.'
node=/opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node
[[ -x $node && $($node --version) == v24.18.0 ]] || die 'Expected pinned Node runtime.'
base=/srv/whataisle-platform
releases=$base/releases
[[ -d $releases && ! -L $base && ! -L $releases ]] || die 'Provision real base/releases directories first.'
[[ $(realpath "$releases") == "$releases" ]] || die 'Release parent contains symlinks.'
# This directory must be root-managed: no application or upload user can alter it.
[[ $(stat -c %u "$base") == 0 && $(stat -c %u "$releases") == 0 ]] || die 'Release parents must be root-owned.'
for parent in "$base" "$releases"; do
  mode=$(stat -c %a "$parent")
  (( (8#$mode & 0022) == 0 )) || die 'Release parents must not be group/world-writable.'
done
exec 9>"$base/.prepare.lock"
flock -n 9 || die 'Another preparation is running.'
release=$releases/$commit
[[ ! -e $release && ! -L $release ]] || die 'Release already exists; never overwrite it.'
# Validate the complete archive before creating the release. Extract regular
# files before links; reject traversal, hardlinks, devices, and link ancestors.
python3 - "$archive" "$release" <<'PY'
import os, pathlib, posixpath, sys, tarfile
archive, release = sys.argv[1:]
with tarfile.open(archive, 'r:gz') as tf:
    entries = {}
    for m in tf.getmembers():
        raw = m.name
        name = posixpath.normpath(raw)
        if name == '.' and m.isdir():
            continue
        if raw.startswith('/') or '..' in pathlib.PurePosixPath(raw).parts or name in entries:
            raise SystemExit('Unsafe or duplicate archive path')
        parts = pathlib.PurePosixPath(name).parts
        if any(p.startswith('.env') or p in ('.git', '.ssh', '.config', 'apps') for p in parts):
            raise SystemExit('Forbidden source/credential path in artifact')
        if not (m.isfile() or m.isdir() or m.issym()):
            raise SystemExit('Unsupported archive entry type')
        if m.issym():
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), m.linkname))
            if m.linkname.startswith('/') or target == '..' or target.startswith('../'):
                raise SystemExit('Archive symlink escapes release')
        entries[name] = m
    for name in entries:
        for parent in pathlib.PurePosixPath(name).parents:
            ancestor = entries.get(str(parent))
            if ancestor and not ancestor.isdir():
                raise SystemExit('Archive path has a non-directory ancestor')
    for required in ('server.js', 'package.json', '.next/BUILD_ID'):
        if required not in entries or not entries[required].isfile():
            raise SystemExit('Missing standalone root file: ' + required)
    for required in ('public/', '.next/static/'):
        if not any(name.startswith(required) for name in entries):
            raise SystemExit('Missing static assets: ' + required)
    os.mkdir(release, 0o750)
    for name, m in sorted(entries.items(), key=lambda item: (item[1].issym(), len(pathlib.PurePosixPath(item[0]).parts))):
        path = os.path.join(release, name)
        os.makedirs(os.path.dirname(path), mode=0o750, exist_ok=True)
        if m.isdir():
            os.makedirs(path, mode=0o750, exist_ok=True)
        elif m.issym():
            os.symlink(m.linkname, path)
        else:
            with tf.extractfile(m) as source, open(path, 'xb') as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
            os.chmod(path, 0o750 if m.mode & 0o111 else 0o640)
PY
# App needs writable Next image/ISR caches. Parent stays root-managed.
chown -R whataisle-platform:whataisle-platform "$release"
printf 'Prepared %s\nNo process started; current and Wherebear are unchanged.\n' "$release"
