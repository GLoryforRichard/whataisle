#!/usr/bin/env bash
# Create the private media bucket with CORS for browser resumable uploads.
set -euo pipefail
. "$(dirname "$0")/config.env"

gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${BUCKET_NAME}" \
       --project="$PROJECT_ID" --location="$REGION" \
       --uniform-bucket-level-access \
       --public-access-prevention

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin" >/dev/null

# CORS for browser direct resumable uploads. GCS CORS cannot express
# wildcard subdomains; upload sessions are unguessable signed session URLs,
# so a permissive origin is acceptable for PUT/POST to session URLs.
CORS_FILE="$(mktemp)"
cat > "$CORS_FILE" <<'JSON'
[
  {
    "origin": ["*"],
    "method": ["GET", "PUT", "POST", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Range", "Range", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
JSON
gcloud storage buckets update "gs://${BUCKET_NAME}" --cors-file="$CORS_FILE"
rm -f "$CORS_FILE"

echo "Bucket ready: gs://${BUCKET_NAME}"
