import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  TARGET,
  ROOTS,
  ProvisioningError,
  atlasUserBody,
  assertAtlasIsolation,
  mongoUri,
  renderEnv,
  caddyConfig,
  sha256,
  searchIndexDefinitions,
} from './store-provisioning-core.mjs';

const exec = promisify(execFile);

export async function safeCommand(command, args) {
  try {
    return await exec(command, args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
    });
  } catch {
    // Never log exec error.message/stdout/stderr: service output may contain
    // connection strings, request bodies, or environment file diagnostics.
    throw new ProvisioningError(
      `COMMAND_FAILED_${path.basename(command).replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
    );
  }
}

export async function ensureDirectory(dir, mode = 0o700) {
  // Parent traversal checks reject links as well; runtime/data/state roots
  // cannot redirect privileged writes through a store-writable path.
  const parts = path.resolve(dir).split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode });
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new ProvisioningError('UNSAFE_DIRECTORY', false);
  }
  return dir;
}

export async function atomicWrite(file, contents, mode = 0o600) {
  await ensureDirectory(path.dirname(file));
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ProvisioningError('UNSAFE_FILE', false);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = `${file}.new-${randomUUID()}`;
  const handle = await fs.open(
    temp,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    mode
  );
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
  await fs.chmod(file, mode);
  const dir = await fs.open(path.dirname(file), 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

export async function readRestrictedJson(file) {
  await ensureExistingParents(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid?.() === 0 && stat.uid !== 0)
    )
      throw new ProvisioningError('SECRET_FILE_PERMISSIONS', false);
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

async function ensureExistingParents(file) {
  let current = '/';
  for (const part of path
    .resolve(path.dirname(file))
    .split('/')
    .filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new ProvisioningError('UNSAFE_DIRECTORY', false);
  }
}

export async function requestJson(
  url,
  options = {},
  accepted = [200, 201, 202, 204]
) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProvisioningError('NETWORK_REQUEST_FAILED');
  }
  if (!accepted.includes(response.status))
    throw new ProvisioningError(
      `HTTP_${response.status}`,
      ![400, 401, 403, 409, 422].includes(response.status)
    );
  if (response.status === 204) return null;
  try {
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  } catch {
    throw new ProvisioningError('INVALID_API_RESPONSE');
  }
}

export function validateConfig(config) {
  if (config.platformUrl !== 'https://www.whataisle.com')
    throw new ProvisioningError('PLATFORM_ORIGIN_NOT_APPROVED', false);
  if (typeof config.workerToken !== 'string' || config.workerToken.length < 32)
    throw new ProvisioningError('WORKER_TOKEN_NOT_CONFIGURED');
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(config.workerId ?? ''))
    throw new ProvisioningError('WORKER_ID_NOT_CONFIGURED');
  if (!/^[a-f0-9]{24}$/.test(config.atlasProjectId ?? ''))
    throw new ProvisioningError('ATLAS_PROJECT_NOT_CONFIGURED');
  if (!config.atlasClientId || !config.atlasClientSecret)
    throw new ProvisioningError('ATLAS_CREDENTIALS_NOT_CONFIGURED');
  if (config.commonRuntimeEnv?.GOOGLE_CLOUD_PROJECT !== TARGET.project)
    throw new ProvisioningError('GOOGLE_PROJECT_NOT_APPROVED', false);
  if (
    !Number.isInteger(config.maxStores) ||
    config.maxStores < 1 ||
    config.maxStores > 5
  )
    throw new ProvisioningError('MAX_STORES_EXCEEDS_MVP_LIMIT', false);
  return config;
}

export async function verifyVm() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw new ProvisioningError('ROOT_ON_APPROVED_VM_REQUIRED', false);
  const get = async (key) => {
    let response;
    try {
      response = await fetch(
        `http://metadata.google.internal/computeMetadata/v1/${key}`,
        {
          headers: { 'Metadata-Flavor': 'Google' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }
      );
    } catch {
      throw new ProvisioningError('VM_IDENTITY_UNAVAILABLE', false);
    }
    if (!response.ok || response.headers.get('Metadata-Flavor') !== 'Google')
      throw new ProvisioningError('VM_IDENTITY_INVALID', false);
    return response.text();
  };
  const [project, instance, zone] = await Promise.all([
    get('project/project-id'),
    get('instance/name'),
    get('instance/zone'),
  ]);
  if (
    project !== TARGET.project ||
    instance !== TARGET.instance ||
    zone.split('/').at(-1) !== TARGET.zone
  )
    throw new ProvisioningError('WRONG_VM_TARGET', false);
}

export async function availablePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function validateRuntime() {
  const actual = await fs.realpath(ROOTS.runtime);
  if (!/^\/srv\/whataisle-store\/releases\/[a-f0-9]{40}$/.test(actual))
    throw new ProvisioningError('UNREVIEWED_RUNTIME_RELEASE', false);
  const manifest = JSON.parse(
    await fs.readFile(path.join(actual, 'store-runtime-manifest.json'), 'utf8')
  );
  if (
    manifest.commit !== path.basename(actual) ||
    manifest.runtimeIdentity !== 'server-env-v1' ||
    manifest.platformContract !== 'v1'
  )
    throw new ProvisioningError('INCOMPATIBLE_RUNTIME_RELEASE', false);
  for (const name of [
    'node_modules/next/dist/bin/next',
    '.next/BUILD_ID',
    '.next/cache',
  ])
    await fs.access(path.join(actual, name));
  const stat = await fs.stat(actual);
  if (stat.uid !== 0 || (stat.mode & 0o022) !== 0)
    throw new ProvisioningError('UNSAFE_RUNTIME_RELEASE', false);
  return manifest.commit;
}

export function platformClient(config) {
  return (endpoint, body) =>
    requestJson(`${config.platformUrl}/api/internal/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.workerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
}

export function atlasClient(config) {
  let accessToken;
  let expiresAt = 0;
  return async (method, suffix, body, accepted) => {
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      const credentials = Buffer.from(
        `${config.atlasClientId}:${config.atlasClientSecret}`
      ).toString('base64');
      const result = await requestJson(
        'https://cloud.mongodb.com/api/oauth/token',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: 'grant_type=client_credentials',
        }
      );
      if (
        typeof result.access_token !== 'string' ||
        !Number.isFinite(result.expires_in)
      )
        throw new ProvisioningError('INVALID_ATLAS_TOKEN');
      accessToken = result.access_token;
      expiresAt = Date.now() + result.expires_in * 1000;
    }
    return requestJson(
      `https://cloud.mongodb.com/api/atlas/v2/groups/${config.atlasProjectId}/${suffix}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.atlas.2025-03-12+json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      accepted
    );
  };
}

async function withMongo(state, config, action) {
  const requireRuntime = createRequire(
    path.join(ROOTS.runtime, 'package.json')
  );
  const { MongoClient } = requireRuntime('mongodb');
  const client = new MongoClient(mongoUri(state, config.atlasHost), {
    serverSelectionTimeoutMS: 20_000,
  });
  try {
    await client.connect();
    return await action(client.db(state.dbName));
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError('STORE_DATABASE_OPERATION_FAILED');
  } finally {
    await client.close();
  }
}

export async function ensureAtlasUser(
  state,
  config,
  atlas,
  assertLease = async () => {}
) {
  let user;
  try {
    user = await atlas('GET', `databaseUsers/admin/${state.dbUser}`);
  } catch (error) {
    if (error.code !== 'HTTP_404') throw error;
    try {
      await assertLease();
      user = await atlas(
        'POST',
        'databaseUsers',
        atlasUserBody(state, config.atlasClusterName)
      );
    } catch (createError) {
      if (createError.code !== 'HTTP_409') throw createError;
      user = await atlas('GET', `databaseUsers/admin/${state.dbUser}`);
    }
  }
  // Never silently rotate an existing user's unknown password or narrow a
  // broader preexisting user. A mismatch requires operator investigation.
  assertAtlasIsolation(user, state, config.atlasClusterName);
}

export async function ensureProductIdentityIndex(
  products,
  assertLease = async () => {}
) {
  const indexes = await products.listIndexes().toArray();
  const identityIndexes = indexes.filter(
    (index) =>
      Object.keys(index.key ?? {}).length === 1 && index.key.name_key === 1
  );
  if (identityIndexes.length) {
    if (
      !identityIndexes.some(
        (index) =>
          index.unique === true &&
          !index.sparse &&
          !index.partialFilterExpression &&
          (!index.collation || index.collation.locale === 'simple')
      )
    )
      throw new ProvisioningError('PRODUCT_IDENTITY_INDEX_MISMATCH', false);
    return;
  }
  await assertLease();
  // The scan pipeline upserts by name_key. A unique index makes simultaneous
  // scans of the same new SKU converge on one document and retain both aisles.
  // Never silently deduplicate existing data to make this operation succeed.
  await products.createIndex(
    { name_key: 1 },
    { name: 'name_key_unique', unique: true }
  );
}

export async function ensureSearchIndexes(
  db,
  model,
  assertLease,
  pause = delay,
  now = Date.now
) {
  const names = await db
    .listCollections({ name: 'products' }, { nameOnly: true })
    .toArray();
  if (!names.length) {
    await assertLease();
    await db.createCollection('products');
  }
  const products = db.collection('products');
  await ensureProductIdentityIndex(products, assertLease);
  const existing = await products.listSearchIndexes().toArray();
  for (const desired of searchIndexDefinitions(model)) {
    const current = existing.find((index) => index.name === desired.name);
    if (!current) {
      await assertLease();
      await products.createSearchIndex(desired);
    } else if (current.type !== desired.type) {
      throw new ProvisioningError('SEARCH_INDEX_TYPE_MISMATCH', false);
    } else if (
      current.type !== desired.type ||
      JSON.stringify(current.latestDefinition) !==
        JSON.stringify(desired.definition)
    ) {
      // API serialization can reorder object keys. Compare the required
      // vector field / lexical mappings rather than accepting arbitrary indexes.
      if (desired.name === 'vector_index') {
        const fields = current.latestDefinition?.fields;
        const field = fields?.[0];
        if (
          fields?.length !== 1 ||
          field.type !== 'autoEmbed' ||
          field.path !== 'search_text' ||
          field.model !== (model ?? 'voyage-4')
        )
          throw new ProvisioningError(
            'SEARCH_INDEX_DEFINITION_MISMATCH',
            false
          );
      } else {
        const fields = current.latestDefinition?.mappings?.fields;
        if (
          current.latestDefinition?.mappings?.dynamic !== false ||
          !['canonical_name', 'aliases', 'search_text'].every(
            (key) => fields?.[key]?.type === 'string'
          )
        )
          throw new ProvisioningError(
            'SEARCH_INDEX_DEFINITION_MISMATCH',
            false
          );
      }
    }
  }
  const deadline = now() + 12 * 60_000;
  while (now() < deadline) {
    await assertLease();
    const indexes = await products.listSearchIndexes().toArray();
    if (
      ['vector_index', 'text_index'].every((name) =>
        indexes.some(
          (index) =>
            index.name === name &&
            index.queryable === true &&
            index.status === 'READY'
        )
      )
    )
      return;
    if (indexes.some((index) => ['FAILED', 'ERROR'].includes(index.status)))
      throw new ProvisioningError('SEARCH_INDEX_BUILD_FAILED');
    await pause(10_000);
  }
  throw new ProvisioningError('SEARCH_INDEX_NOT_READY');
}

async function ensureIndexes(state, config, assertLease) {
  return withMongo(state, config, (db) =>
    ensureSearchIndexes(db, config.embeddingModel, assertLease)
  );
}

async function checkHealth(state, publicCheck = false) {
  const url = publicCheck
    ? `${state.canonicalUrl}/api/runtime/health`
    : `http://127.0.0.1:${state.port}/api/runtime/health`;
  const response = await requestJson(url, {
    headers: { Host: `${state.handle}.whataisle.com` },
  });
  if (
    response?.ok !== true ||
    response.storeId !== state.storeId ||
    response.status !== 'ready'
  )
    throw new ProvisioningError('RUNTIME_IDENTITY_HEALTH_MISMATCH');
}

async function waitHealth(state, assertLease, publicCheck = false) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await assertLease();
    try {
      await checkHealth(state, publicCheck);
      return;
    } catch (error) {
      if (attempt === 29) throw error;
    }
    await delay(2000);
  }
}

export async function routeInstall(
  state,
  { mainFile = '/etc/caddy/Caddyfile', command = safeCommand } = {}
) {
  const main = await fs.readFile(mainFile, 'utf8');
  if (!/^\s*import\s+\/etc\/caddy\/whataisle-stores\/\*\.caddy\s*$/m.test(main))
    throw new ProvisioningError('CADDY_IMPORT_NOT_INSTALLED');
  const expected = caddyConfig(state);
  let previous = null;
  try {
    previous = await fs.readFile(state.routeFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous !== null && previous !== expected)
    throw new ProvisioningError('EXISTING_ROUTE_MISMATCH', false);
  await atomicWrite(state.routeFile, expected, 0o644);
  try {
    await command('/usr/bin/caddy', ['validate', '--config', mainFile]);
    await command('/usr/bin/systemctl', ['reload', 'caddy']);
  } catch (error) {
    // Only the newly-created route is moved aside. No root/platform/WhereBear
    // configuration is rewritten or restored from a stale whole-file backup.
    if (previous === null) {
      await fs.rename(
        state.routeFile,
        `${state.routeFile}.failed-${randomUUID()}`
      );
      try {
        await command('/usr/bin/caddy', ['validate', '--config', mainFile]);
        await command('/usr/bin/systemctl', ['reload', 'caddy']);
      } catch {
        /* Keep the original sanitized failure; no whole-file rollback. */
      }
    }
    throw error;
  }
}

async function unroute(state) {
  try {
    const contents = await fs.readFile(state.routeFile, 'utf8');
    if (contents !== caddyConfig(state))
      throw new ProvisioningError('EXISTING_ROUTE_MISMATCH', false);
    await fs.rename(state.routeFile, `${state.routeFile}.archived`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await safeCommand('/usr/bin/caddy', [
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  ]);
  await safeCommand('/usr/bin/systemctl', ['reload', 'caddy']);
}

export async function removeAtlasUser(
  state,
  config,
  atlas,
  assertLease,
  pause = delay
) {
  let existing;
  try {
    existing = await atlas('GET', `databaseUsers/admin/${state.dbUser}`);
  } catch (error) {
    if (error.code === 'HTTP_404') return;
    throw error;
  }
  assertAtlasIsolation(existing, state, config.atlasClusterName);
  await assertLease();
  try {
    await atlas(
      'DELETE',
      `databaseUsers/admin/${state.dbUser}`,
      undefined,
      [200, 202, 204]
    );
  } catch (error) {
    if (error.code === 'HTTP_404') return;
    throw error;
  }
  // A 202 accepts work; it does not prove credential removal. Do not report
  // successful cleanup until an authenticated follow-up actually sees absence.
  for (let attempt = 0; attempt < 12; attempt++) {
    await assertLease();
    try {
      const user = await atlas('GET', `databaseUsers/admin/${state.dbUser}`);
      assertAtlasIsolation(user, state, config.atlasClusterName);
    } catch (error) {
      if (error.code === 'HTTP_404') return;
      throw error;
    }
    await pause(10_000);
  }
  throw new ProvisioningError('ATLAS_USER_REMOVAL_NOT_CONFIRMED');
}

export function vmAdapters(config, job, runtimeVersion, assertLease) {
  const api = platformClient(config);
  const atlas = atlasClient(config);
  const lease = { jobId: job.jobId, leaseToken: job.leaseToken };
  const save = (state) => atomicWrite(state.stateFile, JSON.stringify(state));
  return {
    assertLease,
    save,
    runtimeVersion,
    credentials: (state) =>
      api('provisioning/credentials', {
        ...lease,
        runtimeTokenHash: sha256(state.runtimeToken),
        port: state.port,
      }),
    database: async (state) => {
      await ensureAtlasUser(state, config, atlas, assertLease);
      await ensureIndexes(state, config, assertLease);
    },
    filesystem: async (state) => {
      await ensureDirectory(ROOTS.data, 0o755);
      await fs.chmod(ROOTS.data, 0o755);
      let exists = true;
      try {
        await safeCommand('/usr/bin/id', ['-u', state.osUser]);
      } catch {
        exists = false;
      }
      if (!exists)
        await safeCommand('/usr/sbin/useradd', [
          '--system',
          '--user-group',
          '--home-dir',
          state.dataDir,
          '--no-create-home',
          '--shell',
          '/usr/sbin/nologin',
          state.osUser,
        ]);
      const account = (
        await safeCommand('/usr/bin/getent', ['passwd', state.osUser])
      ).stdout
        .trim()
        .split(':');
      const groups = (
        await safeCommand('/usr/bin/id', ['-G', state.osUser])
      ).stdout
        .trim()
        .split(/\s+/);
      if (
        account[0] !== state.osUser ||
        Number(account[2]) <= 0 ||
        account[5] !== state.dataDir ||
        account[6] !== '/usr/sbin/nologin' ||
        groups.length !== 1 ||
        groups[0] !== account[3]
      )
        throw new ProvisioningError('UNSAFE_EXISTING_OS_USER', false);
      await ensureDirectory(state.dataDir, 0o751);
      await safeCommand('/usr/bin/chown', ['root:root', state.dataDir]);
      await fs.chmod(state.dataDir, 0o751);
      for (const name of [
        'scan-jobs',
        'billing-journal',
        'cache',
        'home',
        'mcp-logs',
      ]) {
        const dir = path.join(state.dataDir, name);
        await ensureDirectory(dir);
        await safeCommand('/usr/bin/chown', [
          `${state.osUser}:${state.osUser}`,
          dir,
        ]);
        await fs.chmod(dir, 0o700);
      }
      await atomicWrite(state.envFile, renderEnv(state, config));
    },
    runtime: async (state) => {
      // start is safe for an already-running unit; never duplicate/restart a
      // live scan worker solely because the platform retried an acknowledgement.
      await safeCommand('/usr/bin/systemctl', [
        'enable',
        '--now',
        state.service,
      ]);
      await safeCommand('/usr/bin/systemctl', [
        'is-active',
        '--quiet',
        state.service,
      ]);
    },
    health: (state) => waitHealth(state, assertLease),
    routing: routeInstall,
    publicHealth: (state) => waitHealth(state, assertLease, true),
    complete: (details) =>
      api('provisioning/complete', { ...lease, ...details }),
    stop: async (state) => {
      await safeCommand('/usr/bin/systemctl', [
        'disable',
        '--now',
        state.service,
      ]);
    },
    unroute,
    cleanDatabase: async (state) => {
      if (!state.databaseClearedAt) {
        await withMongo(state, config, async (db) => {
          // Bind to the deterministic DB computed from this store's immutable
          // ID, never accept a db/collection path from the platform job.
          for (const collection of await db
            .listCollections({}, { nameOnly: true })
            .toArray()) {
            await assertLease();
            if (collection.name.startsWith('system.')) continue;
            await db.collection(collection.name).drop();
          }
          if (
            (await db.listCollections({}, { nameOnly: true }).toArray()).some(
              (entry) => !entry.name.startsWith('system.')
            )
          )
            throw new ProvisioningError('DATABASE_CLEANUP_INCOMPLETE');
        });
        state.databaseClearedAt = new Date().toISOString();
        await save(state);
      }
      await removeAtlasUser(state, config, atlas, assertLease);
    },
    archiveFiles: async (state) => {
      await ensureDirectory(state.archiveDir);
      for (const [source, name] of [
        [state.dataDir, 'data'],
        [state.envFile, 'runtime.env'],
      ]) {
        const target = path.join(state.archiveDir, name);
        try {
          await fs.lstat(source);
          try {
            await fs.lstat(target);
            throw new ProvisioningError('ARCHIVE_TARGET_EXISTS', false);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          await fs.rename(source, target);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      await fs.chmod(state.archiveDir, 0o700);
    },
  };
}
