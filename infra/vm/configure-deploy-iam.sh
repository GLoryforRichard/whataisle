#!/usr/bin/env bash
# Reviewed one-time provisioning, NOT called by CI. Default is read-only plan.
# No old-project grants, service-account keys, project metadata writes or VM
# changes. The --apply mode creates dedicated identities and additive bindings.
# References:
# https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
# https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys
# https://docs.cloud.google.com/compute/docs/access/iam
set -euo pipefail
umask 077
die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 2 && ( $1 == --plan || $1 == --apply ) ]] || die 'Usage: configure-deploy-iam.sh --plan|--apply NEW_ACCOUNT_EMAIL'
mode=$1
account=$2
[[ $account == whataisle@gmail.com ]] || die 'Use the approved new-account identity.'
project=wherebear-prod-20260902
number=711995364285
vm=wherebear-vm
zone=northamerica-northeast2-b
pool=whataisle-deploy-main
provider=github-main
sa_id=whataisle-vm-deploy
sa=$sa_id@$project.iam.gserviceaccount.com
instance_role=whataisleVmSsh
project_role=whataisleSshProjectRead
actas_role=whataisleVmRuntimeActAs
gcloud_new() { gcloud --account="$account" --project="$project" "$@"; }
[[ $(gcloud_new projects describe "$project" --format='value(projectNumber)') == "$number" ]] || die 'Project number mismatch.'
runtime_sa=$(gcloud_new compute instances describe "$vm" --zone="$zone" --format='value(serviceAccounts[0].email)')
[[ $runtime_sa == *@"$project".iam.gserviceaccount.com || $runtime_sa == "$number"-compute@developer.gserviceaccount.com ]] || die 'Runtime SA is absent or outside approved project; review before granting actAs.'
# Check effective OS Login, without printing unrelated metadata or SSH keys.
instance_oslogin=$(gcloud_new compute instances describe "$vm" --zone="$zone" --format=json |
  python3 -c 'import json,sys; print(next((str(x.get("value", "")) for x in json.load(sys.stdin).get("metadata", {}).get("items", []) if x.get("key") == "enable-oslogin"), ""))')
project_oslogin=$(gcloud_new compute project-info describe --format=json |
  python3 -c 'import json,sys; print(next((str(x.get("value", "")) for x in json.load(sys.stdin).get("commonInstanceMetadata", {}).get("items", []) if x.get("key") == "enable-oslogin"), ""))')
effective_oslogin=${instance_oslogin:-$project_oslogin}
[[ $effective_oslogin != [Tt][Rr][Uu][Ee] ]] || die 'OS Login enabled: metadata SSH mystery is not the approved compatible route.'
printf 'Project: %s (%s)\nVM: %s / %s\nDeployment SA: %s\nRuntime SA receiving scoped actAs: %s\n' "$project" "$number" "$vm" "$zone" "$sa" "$runtime_sa"
printf '%s\n' 'Instance-only permissions: compute.instances.get, compute.instances.setMetadata' \
  'Project read permissions: compute.projects.get, compute.zoneOperations.get, resourcemanager.projects.get' \
  'Runtime-SA-only permission: iam.serviceAccounts.actAs' \
  'Trust: repository_id 1291652074, owner_id 44072670, GLoryforRichard/whataisle, main only' \
  'No Compute/Run/Storage admin, no project-wide SSH key write, no token creator/key generation.'
[[ $mode == --apply ]] || exit 0
# Fail if dedicated names already exist. No accidental reuse, widening or
# overwriting of existing identities. A partially applied run needs operator
# inspection/resume; it must not be blindly rerun or undone by deleting grants.
existing=$(gcloud_new iam service-accounts list --filter="email=$sa" --format='value(email)')
[[ -z $existing ]] || die 'Deploy SA already exists; inspect existing grants before resuming.'
existing=$(gcloud_new iam workload-identity-pools list --location=global --filter="name:/$pool" --format='value(name)')
[[ -z $existing ]] || die 'Pool already exists; inspect before resuming.'
for role in "$instance_role" "$project_role" "$actas_role"; do
  existing=$(gcloud_new iam roles list --filter="name:/$role" --format='value(name)')
  [[ -z $existing ]] || die "Role $role exists; inspect before resuming."
done
enabled=$(gcloud_new services list --enabled --format='value(config.name)')
for api in iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com compute.googleapis.com; do
  [[ $'\n'$enabled$'\n' == *$'\n'"$api"$'\n'* ]] || die "Required API not enabled: $api (operator must enable separately)."
done
# Record policies before additive grants. These contain identities, not keys;
# retain under a restricted local directory and never commit them.
backup=$(mktemp -d /tmp/whataisle-deploy-iam.XXXXXX)
gcloud_new projects get-iam-policy "$project" --format=json > "$backup/project-policy.json"
gcloud_new compute instances get-iam-policy "$vm" --zone="$zone" --format=json > "$backup/instance-policy.json"
gcloud_new iam service-accounts get-iam-policy "$runtime_sa" --format=json > "$backup/runtime-sa-policy.json"
printf 'Pre-change policy backups: %s\n' "$backup"
gcloud_new iam service-accounts create "$sa_id" --display-name='WhatAisle main VM deploy only' --quiet
gcloud_new iam workload-identity-pools create "$pool" --location=global --display-name='WhatAisle main deploy' --quiet
gcloud_new iam workload-identity-pools providers create-oidc "$provider" \
  --location=global --workload-identity-pool="$pool" \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref' \
  --attribute-condition="assertion.repository_id == '1291652074' && assertion.repository_owner_id == '44072670' && assertion.repository == 'GLoryforRichard/whataisle' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:GLoryforRichard/whataisle:ref:refs/heads/main'" --quiet
gcloud_new iam service-accounts add-iam-policy-binding "$sa" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.repository_id/1291652074" \
  --condition=None --quiet
gcloud_new iam roles create "$instance_role" --title='WhatAisle target VM SSH metadata' \
  --permissions=compute.instances.get,compute.instances.setMetadata --stage=GA --quiet
gcloud_new compute instances add-iam-policy-binding "$vm" --zone="$zone" \
  --member="serviceAccount:$sa" --role="projects/$project/roles/$instance_role" --condition=None --quiet
gcloud_new iam roles create "$project_role" --title='WhatAisle SSH project lookup and operation read' \
  --permissions=compute.projects.get,compute.zoneOperations.get,resourcemanager.projects.get --stage=GA --quiet
gcloud_new projects add-iam-policy-binding "$project" \
  --member="serviceAccount:$sa" --role="projects/$project/roles/$project_role" --condition=None --quiet
gcloud_new iam roles create "$actas_role" --title='WhatAisle attached VM identity actAs' \
  --permissions=iam.serviceAccounts.actAs --stage=GA --quiet
gcloud_new iam service-accounts add-iam-policy-binding "$runtime_sa" \
  --member="serviceAccount:$sa" --role="projects/$project/roles/$actas_role" --condition=None --quiet
printf '\nGitHub secret values (identifiers, not private credentials):\nGCP_DEPLOY_SA=%s\nGCP_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$sa" "$number" "$pool" "$provider"
printf '%s\n' 'GitHub secrets are not updated by this script. Verify WIF and ephemeral SSH end-to-end before declaring CI ready.'
# gcloud tries project SSH metadata first, then falls back to instance metadata
# when forbidden (SDK ssh_utils.py EnsureSSHKeyExists). Do not grant
# compute.projects.setCommonInstanceMetadata just to silence that expected 403.
# Metadata SSH grants effective shell/sudo access on this shared VM, not merely
# deployment-path access. Branch/WIF restriction and repo write controls matter.
