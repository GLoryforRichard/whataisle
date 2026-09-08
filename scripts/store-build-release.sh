#!/usr/bin/env bash
# Build a reusable, secret-free Ubuntu 22.04 x86_64/glibc store release.
# This script does not connect to a store DB, activate a release, or deploy.
set -euo pipefail
umask 077

if [[ $# != 2 ]]; then
  echo 'Usage: store-build-release.sh FULL_COMMIT_SHA NEW_ABSOLUTE_BUILD_DIRECTORY' >&2
  exit 2
fi
store_commit="$1"
store_build_dir="$2"
[[ "$store_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full commit SHA required' >&2; exit 2; }
[[ "$store_build_dir" == /* && "$store_build_dir" != *$'\n'* && ! -e "$store_build_dir" ]] || { echo 'A new absolute build directory is required' >&2; exit 2; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Build on Linux x86_64, not the Mac or live store checkout' >&2; exit 2; }
[[ "$(node -p 'process.versions.node')" == 24.18.0 ]] || { echo 'Use the isolated Node 24.18.0 runtime' >&2; exit 2; }
store_tools_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# This check occurs before extraction/npm: Alpine also reports Linux/x86_64,
# but its musl native dependencies cannot run on the serving Ubuntu/glibc VM.
store_build_platform="$(node "$store_tools_dir/store-build-platform.mjs")"
git cat-file -e "${store_commit}^{commit}"
mkdir -m 0700 "$store_build_dir"
git archive "$store_commit" apps/wherebear | tar -xf - -C "$store_build_dir"
store_app_dir="$store_build_dir/apps/wherebear"
cd "$store_app_dir"
# Do not inherit a production store URI, provider key or runtime identity into
# compilation/tests. A temporary non-login env contains only build necessities.
env -i PATH="$PATH" HOME="$store_build_dir" CI=1 npm ci --no-audit --no-fund
# Gemini's module constructs a client during route collection. Supply only a
# non-secret, non-production project placeholder; background work is disabled
# and the final runtime obtains its actual project from its own environment.
env -i PATH="$PATH" HOME="$store_build_dir" CI=1 WHEREBEAR_BACKGROUND_DISABLED=1 GOOGLE_CLOUD_PROJECT=build-only-no-network npm run typecheck
env -i PATH="$PATH" HOME="$store_build_dir" CI=1 WHEREBEAR_BACKGROUND_DISABLED=1 GOOGLE_CLOUD_PROJECT=build-only-no-network npm test
env -i PATH="$PATH" HOME="$store_build_dir" CI=1 WHEREBEAR_BACKGROUND_DISABLED=1 GOOGLE_CLOUD_PROJECT=build-only-no-network npm run build
mkdir -p .next/cache
node - "$store_commit" "$store_build_platform" <<'NODE'
const fs = require('node:fs');
fs.writeFileSync('store-runtime-manifest.json', JSON.stringify({
  commit: process.argv[2], runtimeIdentity: 'server-env-v1', platformContract: 'v1',
  builtAt: new Date().toISOString(), node: process.versions.node,
  buildPlatform: JSON.parse(process.argv[3]),
}) + '\n');
NODE
# There are no production credentials or customer files in this git-only
# source tree. Exclude compiler cache; it is mounted per process at runtime.
# Native build outputs can share an inode (for example ssh2's sshcrypto.node).
# Store each hard-linked path as a regular file for the installer's archive
# safety contract; preserve internal npm symlinks rather than dereferencing them.
tar --hard-dereference --exclude='./.next/cache/*' --exclude='./.git' -czf "$store_build_dir/store-${store_commit}.tgz" .
sha256sum "$store_build_dir/store-${store_commit}.tgz"
echo 'Build/checks complete. Artifact is prepared only; no runtime was activated.'
