import path from 'node:path';
import os from 'node:os';

/** Every managed process gets writable, absolute paths outside the shared release. */
export function runtimeDirectory(variable, env = process.env) {
  const managed = Boolean(env.STORE_RUNTIME_TOKEN) || Boolean(env.STORE_ID && env.STORE_ID !== 'wherebear');
  const value = env[variable];
  if (managed && (!value || !path.isAbsolute(value))) {
    throw new Error(`${variable} must be an absolute store-specific directory`);
  }
  const legacyDefaults = {
    SCAN_JOBS_DIR: path.join(os.tmpdir(), 'wherebear-scan-jobs'),
    MDB_MCP_LOG_PATH: '.mongodb-mcp-server',
  };
  if (!Object.hasOwn(legacyDefaults, variable)) throw new Error('Unknown runtime directory');
  return path.resolve(value || legacyDefaults[variable]);
}
