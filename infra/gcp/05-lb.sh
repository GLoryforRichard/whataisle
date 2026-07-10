#!/usr/bin/env bash
# Global external HTTPS LB in front of Cloud Run with a wildcard cert.
# Run AFTER the Cloud Run service exists. Prints the DNS records to create.
set -euo pipefail
. "$(dirname "$0")/config.env"

# 1. Wildcard cert via Certificate Manager DNS authorization.
gcloud certificate-manager dns-authorizations describe whataisle-dnsauth >/dev/null 2>&1 \
  || gcloud certificate-manager dns-authorizations create whataisle-dnsauth \
       --domain="$ROOT_DOMAIN"

DNS_AUTH_RECORD="$(gcloud certificate-manager dns-authorizations describe whataisle-dnsauth \
  --format='value(dnsResourceRecord.name, dnsResourceRecord.type, dnsResourceRecord.data)')"

gcloud certificate-manager certificates describe whataisle-cert >/dev/null 2>&1 \
  || gcloud certificate-manager certificates create whataisle-cert \
       --domains="${ROOT_DOMAIN},*.${ROOT_DOMAIN}" \
       --dns-authorizations=whataisle-dnsauth

gcloud certificate-manager maps describe whataisle-cert-map >/dev/null 2>&1 \
  || gcloud certificate-manager maps create whataisle-cert-map

for entry in root wildcard; do
  host="$ROOT_DOMAIN"; [ "$entry" = wildcard ] && host="*.${ROOT_DOMAIN}"
  gcloud certificate-manager maps entries describe "whataisle-${entry}" \
      --map=whataisle-cert-map >/dev/null 2>&1 \
    || gcloud certificate-manager maps entries create "whataisle-${entry}" \
         --map=whataisle-cert-map --hostname="$host" \
         --certificates=whataisle-cert
done

# 2. Serverless NEG -> backend -> URL map -> HTTPS proxy -> forwarding rule.
gcloud compute network-endpoint-groups describe whataisle-neg --region="$REGION" >/dev/null 2>&1 \
  || gcloud compute network-endpoint-groups create whataisle-neg \
       --region="$REGION" --network-endpoint-type=serverless \
       --cloud-run-service="$SERVICE_NAME"

gcloud compute backend-services describe whataisle-backend --global >/dev/null 2>&1 \
  || gcloud compute backend-services create whataisle-backend \
       --global --load-balancing-scheme=EXTERNAL_MANAGED

gcloud compute backend-services list --filter='name=whataisle-backend' \
    --format='value(backends[].group)' | grep -q whataisle-neg \
  || gcloud compute backend-services add-backend whataisle-backend \
       --global --network-endpoint-group=whataisle-neg \
       --network-endpoint-group-region="$REGION"

gcloud compute url-maps describe whataisle-urlmap >/dev/null 2>&1 \
  || gcloud compute url-maps create whataisle-urlmap \
       --default-service=whataisle-backend

gcloud compute target-https-proxies describe whataisle-https-proxy >/dev/null 2>&1 \
  || gcloud compute target-https-proxies create whataisle-https-proxy \
       --url-map=whataisle-urlmap \
       --certificate-map=whataisle-cert-map

gcloud compute addresses describe whataisle-ip --global >/dev/null 2>&1 \
  || gcloud compute addresses create whataisle-ip --global

LB_IP="$(gcloud compute addresses describe whataisle-ip --global --format='value(address)')"

gcloud compute forwarding-rules describe whataisle-https --global >/dev/null 2>&1 \
  || gcloud compute forwarding-rules create whataisle-https \
       --global --load-balancing-scheme=EXTERNAL_MANAGED \
       --address=whataisle-ip --target-https-proxy=whataisle-https-proxy \
       --ports=443

# 3. HTTP -> HTTPS redirect.
if ! gcloud compute url-maps describe whataisle-redirect >/dev/null 2>&1; then
  REDIRECT_YAML="$(mktemp)"
  cat > "$REDIRECT_YAML" <<YAML
name: whataisle-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
  gcloud compute url-maps import whataisle-redirect --source="$REDIRECT_YAML" --global
  rm -f "$REDIRECT_YAML"
fi
gcloud compute target-http-proxies describe whataisle-http-proxy >/dev/null 2>&1 \
  || gcloud compute target-http-proxies create whataisle-http-proxy \
       --url-map=whataisle-redirect
gcloud compute forwarding-rules describe whataisle-http --global >/dev/null 2>&1 \
  || gcloud compute forwarding-rules create whataisle-http \
       --global --load-balancing-scheme=EXTERNAL_MANAGED \
       --address=whataisle-ip --target-http-proxy=whataisle-http-proxy \
       --ports=80

cat <<EOF

==> DNS records to create at your DNS host:
    1. ACME auth CNAME:  ${DNS_AUTH_RECORD}
    2. A     ${ROOT_DOMAIN}      -> ${LB_IP}
    3. A     *.${ROOT_DOMAIN}    -> ${LB_IP}

Cert status (must become ACTIVE before HTTPS works):
    gcloud certificate-manager certificates describe whataisle-cert --format='value(managed.state)'

AFTER the LB serves traffic correctly, lock ingress + trust the LB:
    gcloud run services update ${SERVICE_NAME} --region=${REGION} \\
      --ingress=internal-and-cloud-load-balancing \\
      --update-env-vars=TRUST_GCP_LOAD_BALANCER=true
EOF
