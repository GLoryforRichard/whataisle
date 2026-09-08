/** Local, real SMTP/auth acceptance. No E2E bypass, provider email, or production data.
 * node --env-file=.env --import tsx scripts/auth-mail-integration.mts
 * Existing Mailpit is read-only through its HTTP API; fixture messages are retained.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === 'server-only'
        ? 'next/dist/compiled/server-only/empty.js'
        : specifier,
      context
    );
  },
});
const target = new URL(process.env.DATABASE_URL || 'postgres://invalid');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
  'Refusing nonlocal PostgreSQL'
);
assert.equal(target.port, '5433');
const mailpit = 'http://127.0.0.1:8025';
const artifactDirectory = await mkdtemp(
  path.join(tmpdir(), 'whataisle-auth-mail-')
);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const email = `mailcheck-${suffix}@example.test`;
const originalPassword = `Aa9!${randomBytes(18).toString('hex')}`;
const newPassword = `Bb8!${randomBytes(18).toString('hex')}`;
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
await new Promise<void>((resolve) => server.close(() => resolve()));
const base = `http://localhost:${port}`;
const distName = `.next-mailcheck-${suffix}`;
const tsconfigFile = path.join(root, 'tsconfig.json'),
  nextEnvFile = path.join(root, 'next-env.d.ts');
const originalTsconfig = await readFile(tsconfigFile, 'utf8'),
  originalNextEnv = await readFile(nextEnvFile, 'utf8');
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
interface MailSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}
interface MailMessage {
  HTML: string;
  Text: string;
}
async function messages() {
  const response = await fetch(`${mailpit}/api/v1/messages?limit=1000`);
  assert.equal(response.status, 200);
  return (await response.json()).messages as MailSummary[];
}
const originalMessageIds = new Set(
  (await messages()).map((message) => message.ID)
);
const capturedIds = new Set<string>();
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_DIST_DIR: distName,
  NEXT_PUBLIC_BASE_URL: base,
  NEXT_PUBLIC_ROOT_DOMAIN: 'localhost',
  PUBLIC_SIGNUP_ENABLED: 'true',
  PUBLIC_GOOGLE_LOGIN_ENABLED: 'false',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_USER: '',
  SMTP_PASS: '',
  RESEND_API_KEY: '',
  STRIPE_SECRET_KEY: '',
  NEXT_PUBLIC_DEMO_WEBSITE: 'false',
  NEXT_PUBLIC_E2E_TEST_MODE: 'false',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
  E2E_TEST_SECRET: '',
  WHEREBEAR_BACKGROUND_DISABLED: '1',
} satisfies NodeJS.ProcessEnv;
assert.equal(env.MAIL_PROVIDER, 'smtp');
assert.equal(env.SMTP_HOST, '127.0.0.1');
assert.equal(env.SMTP_PORT, '1025');
assert.equal(env.PUBLIC_SIGNUP_ENABLED, 'true');
assert.notEqual(env.E2E_TEST_SECRET, 'mksaas-e2e-secret');
process.env.NEXT_PUBLIC_BASE_URL = base;
const { getDb } =
  require('../src/db/index') as typeof import('../src/db/index');
const { user, verification } =
  require('../src/db/auth.schema') as typeof import('../src/db/auth.schema');
const db = await getDb();
let next: ChildProcess | undefined;
let checks = 0;
function pass(label: string) {
  checks++;
  console.log(`PASS ${label}`);
}
const jar = new Map<string, string>();
function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
}
function remember(response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';')[0];
    const index = part.indexOf('=');
    jar.set(part.slice(0, index), part.slice(index + 1));
  }
}
async function authRequest(route: string, body?: unknown, withCookies = true) {
  const response = await fetch(new URL(route, base), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(withCookies && jar.size ? { Cookie: cookieHeader() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (withCookies) remember(response);
  return response;
}
async function capturedLink(kind: 'verify-email' | 'reset-password') {
  for (let attempt = 0; attempt < 80; attempt++) {
    const own = (await messages()).filter(
      (message) =>
        message.To.some((to) => to.Address === email) &&
        !capturedIds.has(message.ID)
    );
    for (const message of own) {
      const response = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
      assert.equal(response.status, 200);
      const content = (await response.json()) as MailMessage;
      const candidates = [...content.HTML.matchAll(/href="([^"]+)"/g)].map(
        (match) => match[1].replaceAll('&amp;', '&')
      );
      for (const candidate of candidates) {
        try {
          const url = new URL(candidate);
          if (url.pathname.includes(`/api/auth/${kind}`)) {
            assert.equal(
              url.origin,
              base,
              'Email links must stay on this isolated local server'
            );
            capturedIds.add(message.ID);
            return url;
          }
        } catch (error) {
          if (error instanceof assert.AssertionError) throw error;
        }
      }
    }
    await delay(250);
  }
  throw new Error(`No local ${kind} SMTP message was captured`);
}
try {
  // Keep Next's default bind like the project dev/E2E command: binding 127.0.0.1 while visiting localhost turns the next-intl rewrite into an external redirect loop.
  next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--port', String(port)],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  next.stdout?.on('data', () => {});
  next.stderr?.on('data', () => {});
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (next.exitCode !== null) throw new Error('Isolated Next process exited');
    try {
      const response = await authRequest('/api/auth/get-session');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, 'Local authentication server did not become ready');
  let response = await authRequest('/auth/login');
  assert.equal(
    response.status,
    200,
    'The normal-mode English login page must render without a redirect loop'
  );
  pass('normal-mode English login page renders through real locale routing');
  response = await authRequest('/api/auth/sign-up/email', {
    email,
    password: originalPassword,
    name: 'Local mail verification fixture',
    callbackURL: '/dashboard',
  });
  assert.equal(response.status, 200);
  const own = (
    await db
      .select({ id: user.id, verified: user.emailVerified })
      .from(user)
      .where(eq(user.email, email))
  )[0];
  assert.ok(own);
  assert.equal(own.verified, false);
  pass(
    'normal public signup creates an unverified account without an E2E bypass'
  );
  response = await authRequest(
    '/api/auth/sign-in/email',
    { email, password: originalPassword, callbackURL: '/dashboard' },
    false
  );
  assert.equal(response.status, 403);
  pass('an unverified owner cannot log in');
  const verify = await capturedLink('verify-email');
  pass('the real verification email arrives through loopback SMTP in Mailpit');
  response = await authRequest(verify.toString());
  assert.ok([200, 302, 303].includes(response.status));
  response = await authRequest('/api/auth/get-session');
  assert.equal(response.status, 200);
  let session = await response.json();
  assert.equal(session.user.email, email);
  assert.equal(session.user.emailVerified, true);
  pass(
    'opening the captured link verifies the email and automatically logs in'
  );
  response = await authRequest('/api/auth/sign-out', {});
  assert.equal(response.status, 200);
  jar.clear();
  response = await authRequest('/api/auth/sign-in/email', {
    email,
    password: originalPassword,
    callbackURL: '/dashboard',
  });
  assert.equal(response.status, 200);
  response = await authRequest('/api/auth/get-session');
  assert.equal((await response.json()).user.email, email);
  pass('the verified owner can subsequently log in with the original password');
  response = await authRequest(
    '/api/auth/request-password-reset',
    { email, redirectTo: `${base}/auth/reset-password` },
    false
  );
  assert.equal(response.status, 200);
  const reset = await capturedLink('reset-password');
  response = await authRequest(reset.toString(), undefined, false);
  assert.ok([302, 303].includes(response.status));
  const resetPage = new URL(response.headers.get('location')!, base);
  assert.equal(resetPage.origin, base);
  assert.equal(resetPage.pathname, '/auth/reset-password');
  const resetToken = resetPage.searchParams.get('token');
  assert.ok(resetToken);
  pass(
    'password recovery sends a real local email whose link opens the reset form'
  );
  response = await authRequest(
    '/api/auth/reset-password',
    { newPassword, token: resetToken },
    false
  );
  assert.equal(response.status, 200);
  response = await authRequest(
    '/api/auth/sign-in/email',
    { email, password: originalPassword },
    false
  );
  assert.equal(response.status, 401);
  pass('after password reset the previous password is rejected');
  jar.clear();
  response = await authRequest('/api/auth/sign-in/email', {
    email,
    password: newPassword,
    callbackURL: '/dashboard',
  });
  assert.equal(response.status, 200);
  response = await authRequest('/api/auth/get-session');
  session = await response.json();
  assert.equal(session.user.email, email);
  assert.equal(session.user.emailVerified, true);
  pass('the new password logs into the same verified owner account');
  response = await authRequest(
    '/api/auth/reset-password',
    { newPassword: originalPassword, token: resetToken },
    false
  );
  assert.ok(response.status >= 400);
  pass('a consumed password-reset link cannot be reused');
  const afterIds = new Set((await messages()).map((message) => message.ID));
  assert.ok([...originalMessageIds].every((id) => afterIds.has(id)));
  assert.ok(capturedIds.size >= 2);
  pass(
    'existing Mailpit messages remain untouched; only synthetic account mail was read'
  );
  await writeFile(
    path.join(artifactDirectory, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        mailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: 1025,
        e2eBypass: false,
        fixtureEmail: email,
        capturedMessages: capturedIds.size,
        existingMessagesPreserved: originalMessageIds.size,
      },
      null,
      2
    )
  );
  if (process.env.KEEP_AUTH_MAIL_FIXTURE === '1') {
    await writeFile(
      path.join(artifactDirectory, 'browser-fixture.json'),
      JSON.stringify({ base, email, password: newPassword }),
      { mode: 0o600 }
    );
    console.log(
      `Browser fixture ready: ${base}; restricted state: ${artifactDirectory}/browser-fixture.json`
    );
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
    });
  }
  console.log(
    `Real SMTP/auth integration: ${checks}/${checks} checks passed. Artifacts: ${artifactDirectory}`
  );
} finally {
  next?.kill('SIGTERM');
  if (next && next.exitCode === null)
    await new Promise<void>((resolve) => {
      next?.once('exit', () => resolve());
      setTimeout(resolve, 5000).unref();
    });
  const own = (
    await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  )[0];
  if (own) {
    await db.delete(verification).where(eq(verification.value, own.id));
    await db.delete(user).where(eq(user.id, own.id));
  }
  await (
    db as unknown as {
      $client: { end: (options: { timeout: number }) => Promise<void> };
    }
  ).$client.end({ timeout: 5 });
  const currentConfig = JSON.parse(await readFile(tsconfigFile, 'utf8'));
  currentConfig.include = (currentConfig.include as string[]).filter(
    (value) => !value.startsWith(`${distName}/`)
  );
  const originalConfig = JSON.parse(originalTsconfig);
  await writeFile(
    tsconfigFile,
    JSON.stringify(currentConfig) === JSON.stringify(originalConfig)
      ? originalTsconfig
      : `${JSON.stringify(currentConfig, null, 2)}\n`
  );
  const currentNextEnv = await readFile(nextEnvFile, 'utf8');
  if (currentNextEnv.includes(`./${distName}/`))
    await writeFile(nextEnvFile, originalNextEnv);
  try {
    await rename(
      path.join(root, distName),
      path.join(artifactDirectory, 'platform-cache')
    );
  } catch {}
  console.log(
    'Synthetic auth account removed; Mailpit messages retained; local Next stopped.'
  );
}
