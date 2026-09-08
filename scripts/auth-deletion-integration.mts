/** Real HTTP auth + local PostgreSQL acceptance against an existing server.
 * AUTH_DELETION_TEST_BASE_URL=http://localhost:<port> node --env-file=.env
 *   --import tsx scripts/auth-deletion-integration.mts
 * Starts no server; sends no email or Stripe request. Fixtures use verified
 * synthetic accounts, real password hashes, and real HTTP sign-in sessions.
 * Refuses non-loopback HTTP/PostgreSQL and cleans only its unique fixture IDs.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import postgres from 'postgres';

const loopback = ['localhost', '127.0.0.1', '[::1]'];
const base = new URL(
  process.env.AUTH_DELETION_TEST_BASE_URL ?? 'http://invalid'
);
assert.ok(loopback.includes(base.hostname), 'Refusing nonlocal HTTP target');
assert.equal(base.protocol, 'http:', 'Use the existing local HTTP server');
assert.ok(base.port, 'Set the existing local server port explicitly');
assert.equal(base.username + base.password + base.search + base.hash, '');
const database = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
assert.ok(loopback.includes(database.hostname), 'Refusing nonlocal PostgreSQL');
assert.equal(
  database.port,
  '5433',
  'Use the dedicated local PostgreSQL on 5433'
);
assert.ok(
  !database.searchParams.has('host'),
  'Refusing alternate database host'
);

const sql = postgres(database.toString(), { max: 1, onnotice: () => {} });
const marker = `auth-delete-${randomUUID()}`;
const password = `Aa9!${randomBytes(18).toString('hex')}`;
const passwordHash = await hashPassword(password);
const fixtures = ['owner', 'admin', 'unpaid'].map((role) => ({
  id: `${marker}-${role}`,
  email: `${marker}-${role}@example.test`,
  role: role === 'admin' ? 'admin' : 'user',
  hasLedger: role !== 'unpaid',
  token: randomBytes(24).toString('hex'),
  cookies: new Map<string, string>(),
}));
type Fixture = (typeof fixtures)[number];
const ownerIds = fixtures.map((fixture) => fixture.id);
let checks = 0;

async function request(fixture: Fixture, route: string, body?: unknown) {
  const response = await fetch(new URL(`/api/auth${route}`, base), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Origin: base.origin,
      'Content-Type': 'application/json',
      Cookie: [...fixture.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join('; '),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';')[0];
    const separator = part.indexOf('=');
    fixture.cookies.set(part.slice(0, separator), part.slice(separator + 1));
  }
  return response;
}

async function signIn(fixture: Fixture) {
  const response = await request(fixture, '/sign-in/email', {
    email: fixture.email,
    password,
  });
  assert.equal(response.status, 200, 'Verified fixture must sign in over HTTP');
  const result = await response.json();
  assert.ok(
    result.user?.id === fixture.id,
    'Sign-in must resolve its own user'
  );
  assert.ok(fixture.cookies.size > 0, 'Sign-in must issue session cookies');
}

async function snapshot() {
  // Compare complete records in memory; never print tokens, password hashes,
  // or rows, including when assertions fail.
  return {
    users:
      await sql`select * from "user" where id in ${sql(ownerIds)} order by id`,
    accounts:
      await sql`select * from account where user_id in ${sql(ownerIds)} order by id`,
    sessions:
      await sql`select * from session where user_id in ${sql(ownerIds)} order by id`,
    billing:
      await sql`select * from store_subscription where owner_user_id in ${sql(ownerIds)} order by owner_user_id`,
    checkouts:
      await sql`select * from store_checkout where owner_user_id in ${sql(ownerIds)} order by id`,
    verification:
      await sql`select * from verification where id in ${sql(ownerIds)} order by id`,
  };
}

async function rejectWithoutMutation(
  label: string,
  actor: Fixture,
  route: string,
  body?: unknown
) {
  const before = await snapshot();
  const response = await request(actor, route, body);
  assert.equal(response.status, 403, `${label}: deletion must be forbidden`);
  const result = await response.json();
  assert.equal(result.code, 'ACCOUNT_DELETION_UNAVAILABLE');
  assert.ok(
    typeof result.message === 'string' &&
      result.message.includes('billing page') &&
      result.message.includes('support'),
    'Response must explain billing cancellation and account-deletion support'
  );
  assert.ok(
    JSON.stringify(await snapshot()) === JSON.stringify(before),
    `${label}: user, account, session, billing, checkout and token must be intact`
  );
  checks++;
  console.log(
    `PASS ${label}: rejected before any authentication/billing mutation`
  );
}

try {
  await sql.begin(async (transaction) => {
    // postgres 3.4.8's Omit-based TransactionSql declaration drops the actual
    // tagged-template call signatures. Only that existing runtime API is used.
    const tx = transaction as unknown as typeof sql;
    for (const fixture of fixtures) {
      await tx`
        insert into "user" (id, name, email, normalized_email, email_verified, role, created_at, updated_at)
        values (${fixture.id}, 'Local account deletion fixture', ${fixture.email}, ${fixture.email}, true, ${fixture.role}, now(), now())
      `;
      await tx`
        insert into account (id, account_id, user_id, provider_id, password, created_at, updated_at)
        values (${fixture.id}, ${fixture.id}, ${fixture.id}, 'credential', ${passwordHash}, now(), now())
      `;
      await tx`
        insert into verification (id, identifier, value, expires_at, created_at, updated_at)
        values (${fixture.id}, ${`delete-account-${fixture.token}`}, ${fixture.id}, now() + interval '1 hour', now(), now())
      `;
      if (fixture.hasLedger) {
        await tx`
          insert into store_subscription (owner_user_id, currency, plan, status)
          values (${fixture.id}, 'usd', 'month', 'pending')
        `;
        await tx`
          insert into store_checkout (id, owner_user_id, plan, currency, is_test, gift_eligible, price_id, amount, status, created_at, expires_at)
          values (${fixture.id}, ${fixture.id}, 'month', 'usd', false, true, 'price_local_no_provider', 19900, 'reserved', now(), now() + interval '1 hour')
        `;
      }
    }
  });
  for (const fixture of fixtures) await signIn(fixture);
  const baseline = await snapshot();
  assert.equal(baseline.users.length, 3);
  assert.equal(baseline.accounts.length, 3);
  assert.equal(baseline.sessions.length, 3);
  assert.equal(baseline.billing.length, 2);
  assert.equal(baseline.checkouts.length, 2);

  for (const fixture of fixtures) {
    await rejectWithoutMutation(
      `${fixture.role}${fixture.hasLedger ? ' with pending checkout' : ' without ledger'} self delete`,
      fixture,
      '/delete-user',
      { password }
    );
    await rejectWithoutMutation(
      `${fixture.role}${fixture.hasLedger ? ' with pending checkout' : ' without ledger'} valid deletion callback`,
      fixture,
      `/delete-user/callback?token=${fixture.token}`
    );
  }
  await rejectWithoutMutation(
    'admin removes pending owner',
    fixtures[1],
    '/admin/remove-user',
    {
      userId: fixtures[0].id,
    }
  );
  await rejectWithoutMutation(
    'admin removes owner without ledger',
    fixtures[1],
    '/admin/remove-user',
    {
      userId: fixtures[2].id,
    }
  );
  for (const fixture of fixtures) {
    const response = await request(
      fixture,
      '/get-session?disableCookieCache=true'
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(
      result?.user?.id === fixture.id,
      'Existing database-backed session must still authenticate'
    );
    fixture.cookies.clear();
    await signIn(fixture);
  }
  checks++;
  console.log(
    'PASS all existing sessions and fresh password sign-ins still work'
  );
} catch (error) {
  // Assertion values/provider exceptions could contain credentials; keep the
  // report limited to our known check labels and a failing exit status.
  console.error(
    `FAIL account-deletion acceptance after ${checks} passed checks`
  );
  process.exitCode = 1;
} finally {
  try {
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as typeof sql;
      await tx`delete from store_checkout where owner_user_id in ${sql(ownerIds)}`;
      await tx`delete from store_subscription where owner_user_id in ${sql(ownerIds)}`;
      await tx`delete from verification where id in ${sql(ownerIds)}`;
      await tx`delete from session where user_id in ${sql(ownerIds)}`;
      await tx`delete from account where user_id in ${sql(ownerIds)}`;
      await tx`delete from "user" where id in ${sql(ownerIds)}`;
    });
    const remaining = await snapshot();
    assert.ok(Object.values(remaining).every((rows) => rows.length === 0));
    console.log(
      'PASS exact local fixtures removed; unrelated accounts untouched'
    );
  } catch {
    console.error(`FAIL local fixture cleanup; retry exact marker ${marker}`);
    process.exitCode = 1;
  }
  await sql.end();
}
