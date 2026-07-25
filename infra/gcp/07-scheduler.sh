#!/usr/bin/env bash
#
# Cloud Scheduler -> POST /api/jobs/tick
#
# Cloud Run has no background process, so the job queue needs an external
# clock. This creates it. Run once, after 04-deploy.sh, from a shell that is
# authenticated to the project (`gcloud auth login`).
#
# Idempotent: re-running updates the existing job rather than failing.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=config.env
source ./config.env

JOB_NAME="${JOB_NAME:-whataisle-jobs-tick}"
SCHEDULE="${SCHEDULE:-*/2 * * * *}"   # every 2 minutes

if [[ -z "${ADMIN_TASK_TOKEN:-}" ]]; then
  echo "ADMIN_TASK_TOKEN must be set in the environment (same value as the" >&2
  echo "Cloud Run service). It is the bearer the tick endpoint checks." >&2
  exit 1
fi

TICK_URL="${BASE_URL}/api/jobs/tick"

echo "Scheduling ${JOB_NAME} -> ${TICK_URL} (${SCHEDULE})"

# The tick is bounded (5 jobs per call) and returns quickly, so a short
# deadline is right — a hung tick should be retried, not waited on.
ARGS=(
  --location="${REGION}"
  --schedule="${SCHEDULE}"
  --uri="${TICK_URL}"
  --http-method=POST
  --headers="Authorization=Bearer ${ADMIN_TASK_TOKEN}"
  --attempt-deadline=320s
  --max-retry-attempts=1
  --description="Drains the background_job queue (re-embed and friends)."
)

if gcloud scheduler jobs describe "${JOB_NAME}" \
     --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --project="${PROJECT_ID}" "${ARGS[@]}"
else
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --project="${PROJECT_ID}" "${ARGS[@]}"
fi

echo
echo "Done. Verify with:"
echo "  gcloud scheduler jobs run ${JOB_NAME} --location=${REGION} --project=${PROJECT_ID}"
echo "  gcloud run services logs read ${SERVICE_NAME} --region=${REGION} --project=${PROJECT_ID} --limit=20"
echo
echo "Note: ingress is locked to internal-and-cloud-load-balancing, so the"
echo "scheduler reaches the service through the load balancer at BASE_URL."
