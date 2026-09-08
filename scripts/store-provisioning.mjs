#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ROOTS,
  ProvisioningError,
  validateJob,
  storePlan,
  newState,
  validateState,
  provision,
  activate,
  archive,
} from './store-provisioning-core.mjs';
import {
  atomicWrite,
  ensureDirectory,
  readRestrictedJson,
  validateConfig,
  verifyVm,
  validateRuntime,
  availablePort,
  platformClient,
  vmAdapters,
} from './store-provisioning-adapters.mjs';

export async function loadOrCreateState(
  job,
  config,
  readState = readRestrictedJson
) {
  job = validateJob(job);
  const plan = storePlan(job);
  try {
    return validateState(await readState(plan.stateFile), job);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (job.kind !== 'provision')
    throw new ProvisioningError('STORE_STATE_MISSING', false);
  await ensureDirectory(path.join(ROOTS.state, 'stores'));
  const states = [];
  for (const file of await fs.readdir(path.join(ROOTS.state, 'stores'))) {
    if (/^[a-f0-9]{24}\.json$/.test(file))
      states.push(
        await readRestrictedJson(path.join(ROOTS.state, 'stores', file))
      );
  }
  // Customer 1 is deliberately unmanaged by this provisioner and always
  // counts toward the owner-approved five-store shared VM limit.
  if (
    1 + states.filter((state) => !state.archivedAt).length >=
    config.maxStores
  )
    throw new ProvisioningError('MVP_STORE_CAPACITY_REVIEW_REQUIRED', false);
  if (states.some((state) => state.handle === job.handle))
    throw new ProvisioningError('HANDLE_ALREADY_RESERVED', false);
  const reserved = new Set(states.map((state) => state.port));
  for (let port = 3101; port <= 3199; port++) {
    if (!reserved.has(port) && (await availablePort(port))) {
      const state = newState(job, port);
      await atomicWrite(state.stateFile, JSON.stringify(state));
      return state;
    }
  }
  throw new ProvisioningError('NO_FREE_STORE_PORT');
}

export async function runOnce(config, runtimeVersion) {
  const api = platformClient(config);
  const response = await api('provisioning/claim', {
    workerId: config.workerId,
    leaseSeconds: 300,
  });
  if (!response?.job) return false;
  const job = validateJob(response.job);
  if (typeof job.leaseToken !== 'string' || job.leaseToken.length < 32)
    throw new ProvisioningError('INVALID_LEASE_TOKEN');
  let leaseExpiresAt = Date.parse(job.leaseExpiresAt);
  let heartbeatInFlight = null;
  let leaseLost = false;
  const heartbeat = async () => {
    if (heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = (async () => {
      try {
        const result = await api('provisioning/heartbeat', {
          jobId: job.jobId,
          leaseToken: job.leaseToken,
        });
        const next = Date.parse(result.leaseExpiresAt);
        if (!Number.isFinite(next) || next <= Date.now())
          throw new ProvisioningError('INVALID_LEASE_EXPIRY');
        leaseExpiresAt = next;
      } catch {
        leaseLost = true;
      } finally {
        heartbeatInFlight = null;
      }
    })();
    return heartbeatInFlight;
  };
  const timer = setInterval(() => {
    void heartbeat();
  }, 30_000);
  const assertLease = async () => {
    if (
      leaseLost ||
      !Number.isFinite(leaseExpiresAt) ||
      leaseExpiresAt <= Date.now() + 15_000
    )
      throw new ProvisioningError('LEASE_LOST');
  };
  try {
    await assertLease();
    const state = await loadOrCreateState(job, config);
    const adapters = vmAdapters(config, job, runtimeVersion, assertLease);
    if (job.kind === 'archive') await archive(job, state, adapters);
    else if (job.kind === 'activate') await activate(job, state, adapters);
    else await provision(job, state, adapters);
    console.log(
      JSON.stringify({
        event: 'completed',
        kind: job.kind,
        storeId: job.storeId,
      })
    );
  } catch (error) {
    const code =
      error instanceof ProvisioningError
        ? error.code
        : 'PROVISIONING_UNEXPECTED_FAILURE';
    console.error(
      JSON.stringify({
        event: 'failed',
        kind: job.kind,
        storeId: job.storeId,
        code,
      })
    );
    if (!leaseLost && leaseExpiresAt > Date.now()) {
      try {
        await api('provisioning/fail', {
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          code,
          message: code,
          retryable:
            error instanceof ProvisioningError ? error.retryable : true,
        });
      } catch {
        /* The lease expires and the platform retries; never print raw API errors. */
      }
    }
  } finally {
    clearInterval(timer);
    if (heartbeatInFlight) await heartbeatInFlight;
  }
  return true;
}

export async function main(args = process.argv.slice(2)) {
  const value = (name) => args[args.indexOf(name) + 1];
  if (args.includes('--dry-run')) {
    if (!args.includes('--job'))
      throw new ProvisioningError('DRY_RUN_JOB_REQUIRED', false);
    const job = validateJob(
      JSON.parse(await fs.readFile(value('--job'), 'utf8'))
    );
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          kind: job.kind,
          plan: storePlan(job),
          prerequisites: [
            'approved VM identity',
            'root-only worker/Atlas credentials',
            'reviewed runtime release',
            job.kind === 'activate'
              ? 'existing isolated user/state and PIN-confirmed published map; search indexes will be reconciled'
              : 'isolated MongoDB user and ordinary product identity index; no search indexes during provisioning',
            'Caddy import',
            'platform lease API',
          ],
        },
        null,
        2
      )
    );
    return;
  }
  if (
    !args.includes('--apply') ||
    !args.includes('--config') ||
    !args.some((arg) => ['--once', '--watch', '--reconcile'].includes(arg))
  )
    throw new ProvisioningError('EXPLICIT_APPLY_MODE_REQUIRED', false);
  await verifyVm();
  const config = validateConfig(await readRestrictedJson(value('--config')));
  if (!args.includes('--locked')) {
    // flock releases on process death, unlike timestamp lockfiles. No force-
    // deleting another worker's lock on a timeout; only one writer runs on VM.
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        '/usr/bin/flock',
        [
          '--nonblock',
          args.includes('--reconcile')
            ? '/run/lock/whataisle-billing-reconcile.lock'
            : '/run/lock/whataisle-provisioning.lock',
          process.execPath,
          fileURLToPath(import.meta.url),
          ...args,
          '--locked',
        ],
        { stdio: 'inherit' }
      );
      child.once('error', reject);
      child.once('exit', (status) => resolve(status ?? 1));
    });
    if (code !== 0) throw new ProvisioningError('WORKER_LOCKED_OR_FAILED');
    return;
  }
  if (args.includes('--reconcile')) {
    await platformClient(config)('billing/reconcile', {});
    console.log(JSON.stringify({ event: 'billing-reconciled' }));
    return;
  }
  const runtimeVersion = await validateRuntime();
  await ensureDirectory(ROOTS.state);
  await ensureDirectory(ROOTS.secrets);
  await ensureDirectory(ROOTS.routes, 0o755);
  do {
    await runOnce(config, runtimeVersion);
    if (args.includes('--watch')) await delay(15_000);
  } while (args.includes('--watch'));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: 'worker-stopped',
        code:
          error instanceof ProvisioningError
            ? error.code
            : 'WORKER_UNEXPECTED_FAILURE',
      })
    );
    process.exitCode = 1;
  });
}
