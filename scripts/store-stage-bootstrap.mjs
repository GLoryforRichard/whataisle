#!/usr/bin/env node
/** Prepare root-only candidates and backups on the approved VM, never install
 * or activate them. This file itself has not been executed in production.
 * --review is portable and has no writes/network calls.
 * --stage SETTINGS_JSON FULL_STORE_RELEASE_COMMIT requires separate approval.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  TARGET,
  sha256,
  renderEnv,
  newState,
} from './store-provisioning-core.mjs';
import {
  atomicWrite,
  ensureDirectory,
  readRestrictedJson,
  validateConfig,
  verifyVm,
} from './store-provisioning-adapters.mjs';

export const REVIEWED_CADDY_SHA256 =
  'b368ee1d777cb7becabf1c252a8ed63ad9a858c2859b3a2dd0faf46e38efbec8';
export const CADDY_IMPORT = 'import /etc/caddy/whataisle-stores/*.caddy';
const PLATFORM_KEYS = [
  'STRIPE_PRICE_USD_MONTH',
  'STRIPE_PRICE_USD_YEAR',
  'STRIPE_PRICE_CAD_MONTH',
  'STRIPE_PRICE_CAD_YEAR',
  'STRIPE_PRICE_CAD_TEST_MONTH',
  'STORE_BILLING_TEST_EMAILS',
];
export const BOOTSTRAP_FILES = [
  ...['core', 'adapters', null].map((suffix) => ({
    source: `scripts/store-provisioning${suffix ? `-${suffix}` : ''}.mjs`,
    destination: `/opt/whataisle-provisioning/scripts/store-provisioning${suffix ? `-${suffix}` : ''}.mjs`,
    mode: 0o750,
  })),
  ...[
    'whataisle-store@.service',
    'whataisle-stores.slice',
    'whataisle-provisioning.service',
    'whataisle-billing-reconcile.service',
    'whataisle-billing-reconcile.timer',
  ].map((name) => ({
    source: `infra/stores/${name}`,
    destination: `/etc/systemd/system/${name}`,
    mode: 0o644,
  })),
];

export function mergedCaddy(original, expectedDigest = REVIEWED_CADDY_SHA256) {
  if (sha256(original) !== expectedDigest)
    throw new Error(
      'Caddy changed since the read-only review; review it again'
    );
  return `${original}${original.endsWith('\n') ? '' : '\n'}\n${CADDY_IMPORT}\n`;
}

export function mergedPlatformEnv(original, additions, workerToken) {
  if (
    Object.keys(additions).some((key) => !PLATFORM_KEYS.includes(key)) ||
    PLATFORM_KEYS.some((key) => typeof additions[key] !== 'string')
  )
    throw new Error(
      'Only the five Prices and test-email allowlist may be merged'
    );
  for (const key of PLATFORM_KEYS.slice(0, 5))
    if (!/^price_[a-zA-Z0-9]+$/.test(additions[key]))
      throw new Error(`Invalid ${key}`);
  const entries = { ...additions, PROVISIONING_WORKER_TOKEN: workerToken };
  if (
    Object.values(entries).some(
      (value) => /[\r\n\0]/.test(value) || value.includes('REPLACE')
    ) ||
    !/^[a-f0-9]{64}$/.test(workerToken)
  )
    throw new Error('Bootstrap settings contain placeholders or unsafe values');
  // This is an initial-install merge, not a secret-rotation tool. Never replace
  // an existing new-flow value or accidentally source a shell environment.
  for (const key of Object.keys(entries))
    if (new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'm').test(original))
      throw new Error(`Existing ${key} requires explicit configuration review`);
  return (
    `${original}${original.endsWith('\n') ? '' : '\n'}\n` +
    '# Reviewed automatic-store bootstrap\n' +
    Object.entries(entries)
      .map(
        ([key, value]) =>
          `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
      )
      .join('\n') +
    '\n'
  );
}

export async function validateGeminiAuth(
  auth = { mode: 'api-key' },
  worker,
  fetchMetadata = fetch
) {
  const extra = worker.commonRuntimeEnv ?? {};
  const configured = (value) =>
    typeof value === 'string' && value.trim().length > 0;
  if (!configured(extra.OPENROUTER_API_KEY))
    throw new Error('An explicitly configured OpenRouter key is required');
  if (!auth || !['api-key', 'vertex-adc'].includes(auth.mode))
    throw new Error('Select api-key or vertex-adc Gemini authentication');
  const fields =
    auth.mode === 'api-key'
      ? ['mode']
      : ['mode', 'serviceAccountEmail', 'permissionsVerified'];
  if (Object.keys(auth).some((key) => !fields.includes(key)))
    throw new Error('Unexpected Gemini authentication setting');
  if (extra.GOOGLE_CLOUD_PROJECT !== TARGET.project)
    throw new Error('Gemini project differs from the approved target');
  if (auth.mode === 'api-key') {
    if (!configured(extra.GEMINI_API_KEY))
      throw new Error('api-key mode requires a configured Gemini API key');
    return { mode: 'api-key' };
  }
  // This is an operator's explicit IAM/API review declaration, not a grant,
  // token probe or model request. The current VM identity is checked separately.
  if (
    auth.permissionsVerified !== true ||
    typeof auth.serviceAccountEmail !== 'string' ||
    auth.serviceAccountEmail.trim() !== auth.serviceAccountEmail ||
    !/^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.gserviceaccount\.com$/.test(
      auth.serviceAccountEmail
    )
  )
    throw new Error(
      'vertex-adc mode requires reviewed IAM/API access and identity'
    );
  // The runtime SDK selects Developer API whenever this variable is present.
  // Refuse ambiguous settings instead of silently bypassing the reviewed ADC.
  if (Object.hasOwn(extra, 'GEMINI_API_KEY'))
    throw new Error('vertex-adc mode must omit GEMINI_API_KEY');
  const get = async (field) => {
    try {
      const response = await fetchMetadata(
        `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${field}`,
        {
          headers: { 'Metadata-Flavor': 'Google' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!response.ok || response.headers.get('Metadata-Flavor') !== 'Google')
        throw new Error();
      return (await response.text()).trim();
    } catch {
      throw new Error('Current VM ADC identity metadata is unavailable');
    }
  };
  const [email, scopeText] = await Promise.all([get('email'), get('scopes')]);
  if (
    email !== auth.serviceAccountEmail ||
    !scopeText
      .split(/\s+/)
      .includes('https://www.googleapis.com/auth/cloud-platform')
  )
    throw new Error(
      'Current VM ADC identity or OAuth scope differs from review'
    );
  return {
    mode: 'vertex-adc',
    serviceAccountEmail: email,
    permissionsVerified: true,
  };
}

async function stage(settingsPath, releaseCommit) {
  if (!/^[a-f0-9]{40}$/.test(releaseCommit ?? ''))
    throw new Error('Reviewed full store release commit required');
  await verifyVm();
  const settings = await readRestrictedJson(settingsPath);
  if (JSON.stringify(settings).includes('REPLACE'))
    throw new Error('Complete the private settings before staging');
  if (settings.worker?.workerToken)
    throw new Error(
      'Bootstrap generates the new shared token; omit workerToken'
    );
  const workerToken = randomBytes(32).toString('hex');
  const worker = validateConfig({ ...settings.worker, workerToken });
  // stage runs only after verifyVm() on the approved VM. --review never calls
  // metadata, and API-key mode does not depend on a VM service account.
  const geminiAuth = await validateGeminiAuth(settings.geminiAuth, worker);
  // Reuse the worker env allowlist validator without saving a store identity.
  renderEnv(
    newState(
      {
        jobId: 'bootstrap-review',
        storeId: 'bootstrap-review',
        handle: 'bootstrapreview',
      },
      3101
    ),
    worker
  );
  const caddy = await fs.readFile('/etc/caddy/Caddyfile', 'utf8');
  const platform = await fs.readFile(
    '/etc/whataisle-platform/platform.env',
    'utf8'
  );
  const candidateCaddy = mergedCaddy(caddy);
  const candidatePlatform = mergedPlatformEnv(
    platform,
    settings.platform,
    workerToken
  );
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assets = [];
  for (const entry of BOOTSTRAP_FILES) {
    const body = await fs.readFile(path.join(root, entry.source));
    assets.push({ ...entry, body, digest: sha256(body) });
  }
  const dir = `/var/lib/whataisle-provisioning/bootstrap/${Date.now()}-${randomBytes(6).toString('hex')}`;
  await ensureDirectory(dir, 0o700);
  await fs.chmod(dir, 0o700);
  await atomicWrite(`${dir}/Caddyfile.before`, caddy);
  await atomicWrite(`${dir}/platform.env.before`, platform);
  await atomicWrite(`${dir}/Caddyfile.candidate`, candidateCaddy);
  await atomicWrite(`${dir}/platform.env.candidate`, candidatePlatform);
  await atomicWrite(
    `${dir}/worker.json.candidate`,
    `${JSON.stringify(worker, null, 2)}\n`
  );
  for (const [i, asset] of assets.entries())
    await atomicWrite(`${dir}/asset-${i}`, asset.body, 0o600);
  await atomicWrite(
    `${dir}/manifest.json`,
    `${JSON.stringify(
      {
        version: 1,
        releaseCommit,
        geminiAuth,
        createdAt: new Date().toISOString(),
        caddyBefore: sha256(caddy),
        caddyAfter: sha256(candidateCaddy),
        platformBefore: sha256(platform),
        platformAfter: sha256(candidatePlatform),
        workerDigest: sha256(`${JSON.stringify(worker, null, 2)}\n`),
        assets: assets.map(({ body: _, ...asset }, i) => ({
          ...asset,
          file: `asset-${i}`,
        })),
      },
      null,
      2
    )}\n`
  );
  console.log(`Prepared root-only bootstrap candidates at ${dir}`);
  console.log(
    'Existing platform, Caddy, WhereBear, services and databases were not changed.'
  );
}

async function main() {
  if (process.argv.length === 2 || process.argv[2] === '--review') {
    console.log(
      JSON.stringify(
        {
          target:
            'wherebear-prod-20260902 / wherebear-vm / northamerica-northeast2-b',
          caddyBaseSha256: REVIEWED_CADDY_SHA256,
          caddyAddition: CADDY_IMPORT,
          newAssets: BOOTSTRAP_FILES.map((entry) => entry.destination),
          platformAdditionalVariables: [
            ...PLATFORM_KEYS,
            'PROVISIONING_WORKER_TOKEN',
          ],
          geminiAuthentication: {
            default: { mode: 'api-key' },
            optional: {
              mode: 'vertex-adc',
              serviceAccountEmail: 'EXPECTED_VM_SERVICE_ACCOUNT_EMAIL',
              permissionsVerified: true,
            },
            verification:
              'Operator records IAM/API review; stage checks the matching VM email and cloud-platform scope. No token/model request.',
          },
          activation:
            'See docs/STORE-BOOTSTRAP-REVIEW.md; staging does not install or start anything.',
        },
        null,
        2
      )
    );
    return;
  }
  if (process.argv[2] !== '--stage' || process.argv.length !== 5)
    throw new Error(
      'Usage: --review | --stage PRIVATE_SETTINGS_JSON FULL_STORE_RELEASE_COMMIT'
    );
  await stage(process.argv[3], process.argv[4]);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    // Never print provider/config exceptions containing secret material.
    console.error(
      'Bootstrap staging refused; inspect prerequisites and file permissions. No services were activated.'
    );
    process.exitCode = 1;
  });
