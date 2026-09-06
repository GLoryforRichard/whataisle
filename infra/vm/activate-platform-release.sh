#!/usr/bin/env bash
# Platform only. Never edits DB/schema, DNS, Caddy, or any Wherebear process.
set -euo pipefail
umask 027
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || die 'Usage: activate-platform-release.sh FULL_COMMIT_SHA'
[[ $EUID == 0 ]] || die 'Run as root on the approved VM.'
for tool in curl flock systemctl systemd-run realpath ss; do command -v "$tool" >/dev/null || die "Missing $tool"; done
metadata() { curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 5 -H 'Metadata-Flavor: Google' "http://169.254.169.254/computeMetadata/v1/$1"; }
[[ $(metadata project/project-id) == wherebear-prod-20260902 ]] || die 'Wrong GCP project.'
[[ $(metadata instance/name) == wherebear-vm ]] || die 'Wrong GCE instance.'
[[ $(metadata instance/zone) == */zones/northamerica-northeast2-b ]] || die 'Wrong GCE zone.'
base=/srv/whataisle-platform
release=$base/releases/$1
node=/opt/whataisle-platform/node-v24.18.0-linux-x64/bin/node
env_file=/etc/whataisle-platform/platform.env
approved_schema=/etc/whataisle-platform/approved-schema.sha256
service=whataisle-platform.service
[[ -d $release && $(realpath "$release") == "$release" ]] || die 'Expected prepared real release directory.'
for parent in "$base" "$base/releases"; do
  [[ $(stat -c %u "$parent") == 0 ]] || die 'Release parents must be root-owned.'
  mode=$(stat -c %a "$parent")
  (( (8#$mode & 0022) == 0 )) || die 'Release parents must not be group/world-writable.'
done
[[ -x $node && $($node --version) == v24.18.0 ]] || die 'Wrong Node runtime.'
for config in "$env_file" "$approved_schema"; do
  [[ -f $config && ! -L $config && $(stat -c %u "$config") == 0 ]] || die 'Missing root-managed runtime/schema approval.'
  mode=$(stat -c %a "$config")
  (( (8#$mode & 0022) == 0 )) || die 'Runtime/schema approval must not be group/world-writable.'
done
[[ -f $release/server.js && -f $release/schema.sha256 ]] || die 'Missing standalone runtime or schema manifest.'
[[ $(<"$release/schema.sha256") =~ ^[0-9a-f]{64}$ ]] || die 'Invalid schema manifest.'
cmp -s "$release/schema.sha256" "$approved_schema" || die 'Schema changed: operator must validate backup/compatibility and update approval; no migration executed.'
[[ $(systemctl show "$service" --property=WorkingDirectory --value) == "$base/current" ]] || die 'Unexpected platform service working directory.'
exec 9>"$base/.deploy.lock"
flock -n 9 || die 'Another platform deployment is running.'
previous=''
if [[ -L $base/current ]]; then
  previous=$(realpath -e "$base/current")
  [[ $previous =~ ^$base/releases/[0-9a-f]{40}$ && -f $previous/server.js ]] || die 'Previous release is not a valid local rollback target.'
elif [[ -e $base/current ]]; then
  die 'current is a real path; never overwrite it.'
fi
[[ -z $(ss -H -ltn 'sport = :3001') ]] || die 'Candidate port 3001 is already occupied.'
candidate="whataisle-platform-candidate-${1:0:12}-$$"
switched=0
success=0
link_tmp=$base/.current-$$
switch_to() {
  [[ ! -e $link_tmp && ! -L $link_tmp ]] || return 1
  ln -s "$1" "$link_tmp"
  mv -Tf "$link_tmp" "$base/current"
}
cleanup() {
  result=$?
  trap - EXIT INT TERM
  systemctl stop "$candidate.service" >/dev/null 2>&1 || true
  if (( switched && ! success )); then
    printf '%s\n' 'Activation failed; restoring only the previous new-VM platform release.' >&2
    if [[ -n $previous ]]; then
      switch_to "$previous" && systemctl restart "$service" || printf '%s\n' 'ROLLBACK FAILED: operator intervention required.' >&2
    else
      systemctl stop "$service" || true
      # Leave current/release intact for diagnosis. No old-account fallback.
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
smoke() {
  local port=$1 static_path status
  local -a proxy_headers=(-H 'Host: www.whataisle.com' -H 'X-Forwarded-Host: www.whataisle.com' -H 'X-Forwarded-Proto: https')
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 "${proxy_headers[@]}" "http://127.0.0.1:$port/api/ping") || return 1
  [[ $status == 200 ]] || return 1
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "${proxy_headers[@]}" "http://127.0.0.1:$port/") || return 1
  [[ $status == 200 ]] || return 1
  static_path=$(find "$release/.next/static" -type f -name '*.js' -print -quit)
  [[ -n $static_path ]] || return 1
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 "${proxy_headers[@]}" "http://127.0.0.1:$port/_next/static/${static_path#"$release/.next/static/"}") || return 1
  [[ $status == 200 ]]
}
# Reviewed read-only startup/routes only. No scan, webhook, cron or model calls.
systemd-run --quiet --collect --unit="$candidate" \
  --property=User=whataisle-platform --property=Group=whataisle-platform \
  --property="WorkingDirectory=$release" --property="EnvironmentFile=$env_file" \
  --property=TimeoutStopSec=60 --property=KillSignal=SIGTERM \
  --property=NoNewPrivileges=true --property=MemoryMax=1G \
  /usr/bin/env NODE_ENV=production HOSTNAME=localhost PORT=3001 "$node" server.js
ready=0
for attempt in {1..12}; do
  if smoke 3001; then ready=1; break; fi
  sleep 2
done
(( ready )) || die 'Candidate read-only smoke failed; production unchanged.'
systemctl stop "$candidate.service"
# Set before switch so a signal at the atomic rename boundary triggers rollback.
switched=1
switch_to "$release"
systemctl restart "$service"
ready=0
for attempt in {1..12}; do
  if systemctl is-active --quiet "$service" && smoke 3000; then ready=1; break; fi
  sleep 2
done
(( ready )) || die 'Activated platform failed read-only smoke.'
success=1
printf 'Activated %s on platform port 3000. Wherebear untouched.\nBusiness/data acceptance remains separate.\n' "$release"
