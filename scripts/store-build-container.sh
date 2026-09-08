#!/usr/bin/env bash
# Review by default. --run performs a local isolated build, never a deployment.
set -euo pipefail
umask 077

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo 'Usage: store-build-container.sh FULL_COMMIT_SHA NEW_ABSOLUTE_OUTPUT [--plan|--run]' >&2
  exit 2
fi
store_commit="$1"
store_output="$2"
store_mode="${3:---plan}"
[[ "$store_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full commit SHA required' >&2; exit 2; }
[[ "$store_output" == /* && "$store_output" != *$'\n'* && "$store_output" != *,* && ! -e "$store_output" && ! -L "$store_output" ]] || { echo 'A new absolute output path without commas or newlines is required' >&2; exit 2; }
[[ "$store_mode" == --plan || "$store_mode" == --run ]] || { echo 'Use --plan or --run' >&2; exit 2; }

# Official Ubuntu 22.04 linux/amd64 manifest and official Node checksum,
# inspected read-only on 2026-09-08. No floating image tag or unverified Node.
store_image='docker.io/library/ubuntu:22.04@sha256:79676deb51ebb02885b0b9d33788e78a37cf1045ad79d1bb04c6a222c3556b3d'
store_node_sha='55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742'
if [[ "$store_mode" == --plan ]]; then
  printf 'Local build only: commit=%s\nImage=%s\nNode 24.18.0 linux-x64 SHA256=%s\nOutput=%s\n' "$store_commit" "$store_image" "$store_node_sha" "$store_output"
  echo 'Mounts: private committed-source snapshot read-only; new output directory read-write.'
  echo 'Limits: 4 CPUs, 6 GiB memory. No host env, credentials, original store directory, or Docker socket is mounted.'
  echo 'Plan only: no snapshot, output directory, image pull, container, build or deployment was started.'
  exit 0
fi

command -v git >/dev/null
command -v docker >/dev/null
# A remembered remote Docker context must not turn a local build into a cloud
# workload. Check both context and environment endpoint overrides, without
# printing host configuration or sending a request to the engine.
store_docker_endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
[[ "$store_docker_endpoint" == unix://* && ( -z "${DOCKER_HOST:-}" || "$DOCKER_HOST" == unix://* ) ]] || { echo 'A local Unix-socket Docker context is required; remote engines are refused' >&2; exit 2; }
store_source_root="$(git rev-parse --show-toplevel)"
git cat-file -e "${store_commit}^{commit}"
for store_file in scripts/store-build-release.sh scripts/store-build-platform.mjs apps/wherebear/package-lock.json; do
  git cat-file -e "${store_commit}:${store_file}"
done
store_snapshot_root="$(mktemp -d "${TMPDIR:-/tmp}/whataisle-store-source.XXXXXX")"
[[ "$store_snapshot_root" != *,* && "$store_snapshot_root" != *$'\n'* ]] || { echo 'Unsafe temporary mount path' >&2; exit 2; }
store_snapshot="$store_snapshot_root/source.git"
git init --bare --quiet "$store_snapshot"
# A shallow fetch copies only the selected committed tree and one commit. The
# worktree, ignored .env files, local uncommitted changes and Git history are
# never mounted. Retain the private snapshot for review if the build fails.
git -C "$store_snapshot" -c protocol.file.allow=always fetch --quiet --no-tags --depth=1 "$store_source_root" "$store_commit"
[[ "$(git -C "$store_snapshot" rev-parse FETCH_HEAD)" == "$store_commit" ]] || { echo 'Snapshot commit mismatch' >&2; exit 2; }
if git -C "$store_snapshot" ls-tree -r --name-only "$store_commit" | awk -F/ '{ for (i=1; i<=NF; i++) if (($i == ".env" || $i ~ /^\.env\./) && $i != ".env.example") found=1 } END { exit !found }'; then
  echo 'Tracked environment file refused; inspect the reviewed source commit' >&2
  exit 2
fi
mkdir -m 0700 "$store_output"
docker run --rm -i --platform linux/amd64 --cpus 4 --memory 6g \
  --mount "type=bind,src=$store_snapshot,dst=/source.git,readonly" \
  --mount "type=bind,src=$store_output,dst=/output" \
  "$store_image" bash -s -- "$store_commit" "$store_node_sha" <<'CONTAINER'
set -euo pipefail
umask 077
store_commit="$1"
store_node_sha="$2"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl xz-utils git python3 make g++
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz \
  -o /tmp/store-node.tar.xz
printf '%s  /tmp/store-node.tar.xz\n' "$store_node_sha" | sha256sum --check --status
mkdir -m 0755 /opt/store-node
tar -xJf /tmp/store-node.tar.xz --strip-components=1 -C /opt/store-node
export PATH="/opt/store-node/bin:$PATH"
git config --global --add safe.directory /source.git
cd /source.git
mkdir -m 0700 /tmp/store-build-tools
git show "$store_commit:scripts/store-build-release.sh" > /tmp/store-build-tools/store-build-release.sh
git show "$store_commit:scripts/store-build-platform.mjs" > /tmp/store-build-tools/store-build-platform.mjs
bash /tmp/store-build-tools/store-build-release.sh "$store_commit" /output/build
cd /output/build
sha256sum "store-${store_commit}.tgz" > "/output/store-${store_commit}.sha256"
CONTAINER
printf 'Prepared artifact: %s/build/store-%s.tgz\nRetained source snapshot: %s\n' "$store_output" "$store_commit" "$store_snapshot_root"
echo 'No deployment or service activation was performed.'
