import * as appSchema from './app.schema';
import * as authSchema from './auth.schema';
import * as storeSchema from './store.schema';

/**
 * Re-export all tables so drizzle-kit can discover them when reading this file.
 * https://orm.drizzle.team/docs/drizzle-kit-generate
 */
export * from './auth.schema';
export * from './app.schema';
export * from './store.schema';

export const schema = {
  ...authSchema,
  ...appSchema,
  ...storeSchema,
} as const;
