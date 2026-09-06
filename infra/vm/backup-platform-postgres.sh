#!/usr/bin/env bash
# Root-only local PostgreSQL backup; never deletes local or remote backups.
set -Eeuo pipefail
umask 077
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 0 && $EUID == 0 ]] || die 'Run without arguments as root.'
[[ $(uname -s) == Linux ]] || die 'Requires the approved Linux VM.'
for tool in curl python3 flock runuser sha256sum mktemp stat realpath; do
  command -v "$tool" >/dev/null || die "Missing $tool"
done
pg_dump=/usr/lib/postgresql/17/bin/pg_dump
[[ -x $pg_dump ]] || die 'PostgreSQL 17 is required.'
metadata() {
  curl -q --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 10 \
    -H 'Metadata-Flavor: Google' "http://169.254.169.254/computeMetadata/v1/$1"
}
[[ $(metadata project/project-id) == wherebear-prod-20260902 ]] || die 'Wrong GCP project.'
[[ $(metadata instance/name) == wherebear-vm ]] || die 'Wrong GCE instance.'
[[ $(metadata instance/zone) == */zones/northamerica-northeast2-b ]] || die 'Wrong GCE zone.'

base=/var/backups/whataisle-postgres
[[ ! -L $base ]] || die 'Backup directory must not be a symlink.'
if [[ ! -e $base ]]; then mkdir -m 0700 "$base"; fi
[[ -d $base && $(realpath "$base") == "$base" ]] || die 'Unsafe backup directory.'
[[ $(stat -c %u "$base") == 0 && $(stat -c %a "$base") == 700 ]] || die 'Backup directory must be root-owned mode 0700.'
exec 9>"$base/.backup.lock"
flock -n 9 || die 'Another PostgreSQL backup is running.'
stamp=$(date -u +%Y%m%dT%H%M%SZ)
run=$(mktemp -d "$base/$stamp.XXXXXXXX")
name=whataisle-${run##*/}.dump
trap 'printf "Backup failed; restricted local files retained at %s\n" "$run" >&2' ERR

# Redirect as root: postgres never needs access to the restricted backup folder.
# Force the local socket and database, ignoring caller-supplied libpq settings.
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin runuser -u postgres -- "$pg_dump" \
  --host=/var/run/postgresql --port=5432 --username=postgres \
  --dbname=whataisle --format=custom --no-owner --no-acl --no-password \
  >"$run/$name" 2>"$run/pg-dump.stderr"
[[ -s $run/$name ]] || die 'Empty dump; local files retained.'
(cd "$run" && sha256sum "$name" >"$name.sha256")

# Use only the attached VM service account's short-lived metadata token.
# Direct JSON objects.insert needs objects.create only: unlike the CLI it never
# probes the destination with objects.get. No SDK/home directory/private key.
# https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
token=$(metadata instance/service-accounts/default/token | python3 -c \
  'import json,sys; value=json.load(sys.stdin)["access_token"]; assert isinstance(value,str) and value; print(value)')
upload() {
  local file=$1 object=$2 label=$3 code
  # The generated name contains only URL-safe ASCII; encode the prefix slash.
  [[ $object =~ ^[A-Za-z0-9.-]+$ ]] || die 'Unsafe generated object name.'
  # Feed Authorization through a pipe, not process arguments or a disk file.
  # curl -q ignores any root curlrc (including logging/redirect settings).
  code=$(curl -q --fail --silent --show-error --connect-timeout 10 --max-time 1800 \
    --request POST --upload-file "$file" \
    --header @<(printf 'Authorization: Bearer %s\n' "$token") \
    --header 'Content-Type: application/octet-stream' \
    --output "$run/upload-$label.json" --write-out '%{http_code}' \
    "https://storage.googleapis.com/upload/storage/v1/b/wherebear-prod-20260902-whataisle-backups/o?uploadType=media&name=postgres%2F$object&ifGenerationMatch=0&fields=name,size,md5Hash" \
    2>"$run/upload-$label.stderr")
  [[ $code == 200 || $code == 201 ]] || die 'Upload did not return success; local files retained.'
  # Validate the insert response directly; do not grant/read remote objects.
  python3 - "$file" "$run/upload-$label.json" "postgres/$object" <<'PY'
import base64, hashlib, json, os, sys
path, response, name = sys.argv[1:]
with open(response) as stream:
    result = json.load(stream)
digest = hashlib.md5()
with open(path, 'rb') as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(block)
if (result.get('name') != name
        or int(result.get('size', -1)) != os.path.getsize(path)
        or result.get('md5Hash') != base64.b64encode(digest.digest()).decode()):
    raise SystemExit('Upload response integrity check failed; local files retained.')
PY
}
# Generation zero rejects existing live objects; an uncertain result is failed,
# never retried as an overwrite or incorrectly reported as a complete backup.
upload "$run/$name" "$name" dump
upload "$run/$name.sha256" "$name.sha256" checksum
unset token
printf 'PostgreSQL dump and checksum uploaded; local backup retained at %s\n' "$run"
