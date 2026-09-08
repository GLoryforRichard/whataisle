import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export class ProvisioningError extends Error {
  constructor(code, retryable = true) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export const TARGET = Object.freeze({
  project: 'wherebear-prod-20260902',
  instance: 'wherebear-vm',
  zone: 'northamerica-northeast2-b',
});
export const ROOTS = Object.freeze({
  state: '/var/lib/whataisle-provisioning',
  data: '/var/lib/whataisle-stores',
  secrets: '/etc/whataisle-stores',
  routes: '/etc/caddy/whataisle-stores',
  archive: '/var/lib/whataisle-provisioning/archive',
  runtime: '/srv/whataisle-store/current',
});
const reserved = new Set(['wherebear', 'www', 'api', 'admin', 'mail', 'app']);
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

export function validateJob(input) {
  if (!input || typeof input !== 'object')
    throw new ProvisioningError('INVALID_JOB', false);
  for (const field of ['jobId', 'storeId']) {
    if (
      typeof input[field] !== 'string' ||
      !/^[a-zA-Z0-9_-]{3,100}$/.test(input[field])
    ) {
      throw new ProvisioningError('INVALID_JOB_ID', false);
    }
  }
  if (
    typeof input.handle !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(input.handle) ||
    reserved.has(input.handle) ||
    input.storeId === 'wherebear'
  ) {
    throw new ProvisioningError('INVALID_STORE_HANDLE', false);
  }
  if (
    !['provision', 'activate', 'archive'].includes(input.kind ?? 'provision')
  ) {
    throw new ProvisioningError('INVALID_JOB_KIND', false);
  }
  return { ...input, kind: input.kind ?? 'provision' };
}

export function storePlan(input, port = 3101) {
  const job = validateJob(input);
  if (!Number.isSafeInteger(port) || port < 3101 || port > 3199)
    throw new ProvisioningError('INVALID_PORT', false);
  const key = sha256(job.storeId).slice(0, 24);
  return {
    storeId: job.storeId,
    handle: job.handle,
    key,
    port,
    osUser: `wa-${key}`,
    dbName: `wa_${key}`,
    dbUser: `wa_${key}`,
    canonicalUrl: `https://${job.handle}.whataisle.com`,
    dataDir: path.join(ROOTS.data, key),
    stateFile: path.join(ROOTS.state, 'stores', `${key}.json`),
    envFile: path.join(ROOTS.secrets, `${key}.env`),
    routeFile: path.join(ROOTS.routes, `${key}.caddy`),
    archiveDir: path.join(ROOTS.archive, key),
    service: `whataisle-store@${key}.service`,
  };
}

export function newState(job, port) {
  if (validateJob(job).kind !== 'provision')
    throw new ProvisioningError('STORE_STATE_CREATION_NOT_ALLOWED', false);
  return {
    version: 1,
    ...storePlan(job, port),
    runtimeToken: randomBytes(48).toString('base64url'),
    sessionSecret: randomBytes(48).toString('base64url'),
    dbPassword: randomBytes(48).toString('base64url'),
    completedStages: [],
    createdAt: new Date().toISOString(),
  };
}

export function validateState(state, job) {
  const expected = storePlan(job, state.port);
  for (const key of Object.keys(expected)) {
    if (state[key] !== expected[key])
      throw new ProvisioningError('STATE_IDENTITY_MISMATCH', false);
  }
  for (const key of ['runtimeToken', 'sessionSecret', 'dbPassword']) {
    if (
      typeof state[key] !== 'string' ||
      !/^[a-zA-Z0-9_-]{64}$/.test(state[key])
    )
      throw new ProvisioningError('STATE_SECRET_INVALID', false);
  }
  if (!Array.isArray(state.completedStages))
    throw new ProvisioningError('STATE_INVALID', false);
  return state;
}

export function caddyConfig(state) {
  const plan = storePlan(
    { jobId: 'render', storeId: state.storeId, handle: state.handle },
    state.port
  );
  return `# Managed WhatAisle store ${plan.key}. No credentials in this file.\n${plan.handle}.whataisle.com {\n\treverse_proxy 127.0.0.1:${plan.port} {\n\t\tflush_interval -1\n\t\tlb_try_duration 5s\n\t}\n}\n`;
}

export function atlasUserBody(state, clusterName) {
  if (
    typeof clusterName !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(clusterName)
  )
    throw new ProvisioningError('ATLAS_CLUSTER_NOT_CONFIGURED');
  return {
    databaseName: 'admin',
    username: state.dbUser,
    password: state.dbPassword,
    roles: [{ databaseName: state.dbName, roleName: 'readWrite' }],
    scopes: [{ name: clusterName, type: 'CLUSTER' }],
  };
}

export function assertAtlasIsolation(user, state, clusterName) {
  const role = user.roles?.[0];
  const scope = user.scopes?.[0];
  if (
    user.username !== state.dbUser ||
    user.databaseName !== 'admin' ||
    user.roles?.length !== 1 ||
    role.databaseName !== state.dbName ||
    role.roleName !== 'readWrite' ||
    role.collectionName ||
    user.scopes?.length !== 1 ||
    scope.name !== clusterName ||
    scope.type !== 'CLUSTER'
  ) {
    throw new ProvisioningError('ATLAS_USER_ISOLATION_MISMATCH', false);
  }
}

export function mongoUri(state, host) {
  if (
    typeof host !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]*\.mongodb\.net$/.test(host)
  )
    throw new ProvisioningError('ATLAS_HOST_NOT_CONFIGURED');
  return `mongodb+srv://${encodeURIComponent(state.dbUser)}:${encodeURIComponent(state.dbPassword)}@${host}/${state.dbName}?authSource=admin&retryWrites=true&w=majority`;
}

export function renderEnv(state, config) {
  const allowed = new Set([
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_SCAN_MODEL',
    'GEMINI_ALIAS_MODEL',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'SEARCH_ENGINE',
  ]);
  const extra = config.commonRuntimeEnv ?? {};
  for (const key of Object.keys(extra)) {
    if (!allowed.has(key))
      throw new ProvisioningError('RUNTIME_ENV_NOT_ALLOWED', false);
  }
  const values = {
    ...extra,
    NODE_ENV: 'production',
    PATH: '/opt/whataisle-platform/node-v24.18.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    STORE_ID: state.storeId,
    STORE_HANDLE: state.handle,
    STORE_CANONICAL_URL: state.canonicalUrl,
    WHATAISLE_PLATFORM_URL: config.platformUrl,
    STORE_RUNTIME_TOKEN: state.runtimeToken,
    STORE_SESSION_SECRET: state.sessionSecret,
    MONGODB_URI: mongoUri(state, config.atlasHost),
    MONGODB_DB: state.dbName,
    SCAN_JOBS_DIR: `${state.dataDir}/scan-jobs`,
    STORE_DATA_DIR: state.dataDir,
    HOME: `${state.dataDir}/home`,
    BILLING_JOURNAL_DIR: `${state.dataDir}/billing-journal`,
    MDB_MCP_LOG_PATH: `${state.dataDir}/mcp-logs`,
    PORT: String(state.port),
    HOSTNAME: '127.0.0.1',
    WHEREBEAR_BACKGROUND_DISABLED: '0',
    WORKER_PHOTO_CONCURRENCY: '1',
    GEMINI_MAX_CONCURRENT: '2',
    OPENROUTER_MAX_CONCURRENT: '2',
    FLEX_MAX_CONCURRENT: '2',
    SCAN_JOBS_MAX_QUEUED: '20',
    SCAN_LAB_ENABLED: '0',
  };
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (typeof value !== 'string' || /[\r\n\0]/.test(value))
          throw new ProvisioningError('INVALID_ENV_VALUE', false);
        // systemd EnvironmentFile values are not shell input. Quote every value;
        // escape its quote/backslash only, never interpolate a command.
        return `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
      })
      .join('\n') + '\n'
  );
}

export function searchIndexDefinitions(model = 'voyage-4') {
  if (!['voyage-4', 'voyage-4-large', 'voyage-4-lite'].includes(model))
    throw new ProvisioningError('INVALID_EMBEDDING_MODEL', false);
  return [
    {
      name: 'vector_index',
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'autoEmbed', path: 'search_text', modality: 'text', model },
        ],
      },
    },
    {
      name: 'text_index',
      type: 'search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            canonical_name: { type: 'string', analyzer: 'lucene.standard' },
            aliases: { type: 'string', analyzer: 'lucene.standard' },
            search_text: { type: 'string', analyzer: 'lucene.standard' },
          },
        },
      },
    },
  ];
}

/** Retry all reconciliation stages. Each adapter verifies its observed state;
 * a local stage marker alone never substitutes for a live check after a crash. */
export async function provision(job, state, adapters) {
  validateState(state, job);
  if (state.archivedAt)
    throw new ProvisioningError('STORE_ALREADY_ARCHIVED', false);
  const run = async (name, action) => {
    await adapters.assertLease();
    await action();
    if (!state.completedStages.includes(name)) state.completedStages.push(name);
    await adapters.save(state);
  };
  await run('credentials', () => adapters.credentials(state));
  await run('database', () => adapters.database(state));
  await run('filesystem', () => adapters.filesystem(state));
  await run('runtime', () => adapters.runtime(state));
  await run('health', () => adapters.health(state));
  await run('routing', () => adapters.routing(state));
  await run('public-health', () => adapters.publicHealth(state));
  await adapters.assertLease();
  await adapters.complete({
    runtimeTokenHash: sha256(state.runtimeToken),
    port: state.port,
    canonicalUrl: state.canonicalUrl,
    runtimeVersion: adapters.runtimeVersion,
    kind: 'provision',
  });
}

/** Activation only reconciles search indexes for an existing, published store.
 * Never recreate credentials, directories, maps, routes or the serving process.
 * Local stage markers are not evidence: every retry reads the live state again.
 */
export async function activate(job, state, adapters) {
  if (validateJob(job).kind !== 'activate')
    throw new ProvisioningError('INVALID_JOB_KIND', false);
  validateState(state, job);
  if (state.archivedAt || state.databaseClearedAt)
    throw new ProvisioningError('STORE_ALREADY_ARCHIVED', false);
  await adapters.assertLease();
  await adapters.existingIdentity(state);
  await adapters.assertLease();
  await adapters.health(state);
  await adapters.assertLease();
  await adapters.publishedMap(state);
  await adapters.assertLease();
  await adapters.search(state);
  await adapters.assertLease();
  await adapters.health(state);
  await adapters.assertLease();
  await adapters.publicHealth(state);
  await adapters.assertLease();
  // Platform searchReady remains false until this leased acknowledgement.
  // Waiting for health.searchReady here would create a circular dependency.
  await adapters.complete({
    kind: 'activate',
    runtimeTokenHash: sha256(state.runtimeToken),
    port: state.port,
    canonicalUrl: state.canonicalUrl,
  });
}

export async function archive(job, state, adapters) {
  validateState(state, job);
  await adapters.assertLease();
  await adapters.stop(state);
  await adapters.unroute(state);
  // Database deletion is irreversible and only happens for an administrator-
  // confirmed archive job, after both sources of new writes are disabled.
  await adapters.assertLease();
  await adapters.cleanDatabase(state);
  await adapters.archiveFiles(state);
  state.archivedAt ??= new Date().toISOString();
  await adapters.save(state);
  await adapters.assertLease();
  await adapters.complete({ kind: 'archive', archivedAt: state.archivedAt });
}
