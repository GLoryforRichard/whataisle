#!/usr/bin/env bash
# Build amd64 images, push to Artifact Registry, run migrations, deploy Cloud Run.
set -euo pipefail
. "$(dirname "$0")/config.env"

TAG="${TAG:-$(git rev-parse --short HEAD)}"
CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_BASE_URL="$BASE_URL" \
  --build-arg NEXT_PUBLIC_ROOT_DOMAIN="$ROOT_DOMAIN" \
  -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" \
  --push .

docker buildx build --platform linux/amd64 \
  -f Dockerfile.migrate \
  -t "${MIGRATE_IMAGE}:${TAG}" -t "${MIGRATE_IMAGE}:latest" \
  --push .

# Migration job (create or update), then execute and wait.
if gcloud run jobs describe "$MIGRATE_JOB_NAME" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$MIGRATE_JOB_NAME" --region="$REGION" \
    --image="${MIGRATE_IMAGE}:${TAG}"
else
  gcloud run jobs create "$MIGRATE_JOB_NAME" --region="$REGION" \
    --image="${MIGRATE_IMAGE}:${TAG}" \
    --service-account="$RUNTIME_SA" \
    --set-cloudsql-instances="$CONNECTION_NAME" \
    --set-secrets=DATABASE_URL=DATABASE_URL:latest \
    --max-retries=0 --task-timeout=600
fi
gcloud run jobs execute "$MIGRATE_JOB_NAME" --region="$REGION" --wait

# Deploy the app.
gcloud run deploy "$SERVICE_NAME" --region="$REGION" \
  --image="${IMAGE}:${TAG}" \
  --service-account="$RUNTIME_SA" \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --allow-unauthenticated \
  --cpu=1 --memory=1Gi --min-instances=0 --max-instances=4 \
  --set-env-vars="NODE_ENV=production,MAIL_PROVIDER=resend,STORAGE_PROVIDER=gcs,STORAGE_BUCKET_NAME=${BUCKET_NAME},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},NEXT_PUBLIC_BASE_URL=${BASE_URL},NEXT_PUBLIC_ROOT_DOMAIN=${ROOT_DOMAIN},TRUST_GCP_LOAD_BALANCER=false" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest,STAFF_COOKIE_SECRET=STAFF_COOKIE_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest"

gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)'
