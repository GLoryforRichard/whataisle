#!/usr/bin/env bash
# Create Cloud SQL Postgres (pgvector), database/user, and Secret Manager secrets.
# Usage: RESEND_API_KEY=... [GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...] ./03-sql-secrets.sh
set -euo pipefail
. "$(dirname "$0")/config.env"

if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_17 \
    --edition=enterprise \
    --tier="$SQL_TIER" \
    --region="$REGION" \
    --storage-size=10GB --storage-auto-increase \
    --backup --backup-start-time=03:00 \
    --maintenance-window-day=SUN --maintenance-window-hour=4
fi

gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 \
  || gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
else
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
fi

CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

# Enable pgvector (requires a temporary connection; use cloud-sql-proxy or
# run this manually in Cloud SQL Studio if the proxy is unavailable):
#   CREATE EXTENSION IF NOT EXISTS vector;
echo "NOTE: run 'CREATE EXTENSION IF NOT EXISTS vector;' as postgres on ${DB_NAME} (Cloud SQL Studio is easiest)."

upsert_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then return 0; fi
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=-
  fi
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
}

upsert_secret DATABASE_URL "$DATABASE_URL"
upsert_secret BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
upsert_secret STAFF_COOKIE_SECRET "$(openssl rand -base64 32)"
upsert_secret RESEND_API_KEY "${RESEND_API_KEY:-}"
upsert_secret GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
upsert_secret GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"

echo "Cloud SQL ready: ${CONNECTION_NAME}; secrets stored in Secret Manager."
