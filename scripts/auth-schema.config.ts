import { getDbSync } from '../src/db';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';

/**
 * Schema-only Better Auth configuration.
 *
 * Runtime auth intentionally does not register the API-key plugin. It remains
 * here so regenerating the legacy auth tables is non-destructive while API-key
 * data is retained for backwards-compatible cleanup and migrations.
 */
export const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-secret-not-for-runtime-use',
  database: drizzleAdapter(getDbSync(), { provider: 'pg' }),
  user: {
    additionalFields: {
      customerId: {
        type: 'string',
        required: false,
      },
    },
  },
  plugins: [admin(), apiKey()],
});
