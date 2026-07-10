#!/usr/bin/env bash
# Workload Identity Federation for GitHub Actions keyless deploys.
# Usage: GITHUB_REPO="owner/repo" ./06-wif.sh
set -euo pipefail
. "$(dirname "$0")/config.env"

GITHUB_REPO="${GITHUB_REPO:?set GITHUB_REPO=owner/repo}"
DEPLOY_SA_NAME="whataisle-deploy"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$DEPLOY_SA_NAME" \
       --display-name="WhatAisle GitHub Actions deployer"

for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA}" --role="$role" \
    --condition=None --quiet >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/iam.serviceAccountUser" --quiet >/dev/null

gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create github \
       --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers describe github-oidc \
    --location=global --workload-identity-pool=github >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc github-oidc \
       --location=global --workload-identity-pool=github \
       --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
       --attribute-condition="assertion.repository == '${GITHUB_REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

cat <<EOF
WIF ready. GitHub Actions values:
  workload_identity_provider: projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-oidc
  service_account: ${DEPLOY_SA}
EOF
