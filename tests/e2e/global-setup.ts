import {
  chromium,
  request,
  type BrowserContext,
  type FullConfig,
  type Page,
} from '@playwright/test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_TEST_SECRET, createE2EUser } from './fixtures/test-data';

// Next dev compiles these entry points on demand, unlike a production build.
// This separate preparation budget never changes a test's operation deadlines.
const compilationTimeout = 120_000;
const publicRoutes = [
  '/',
  '/pricing',
  '/about',
  '/contact',
  '/cookie',
  '/privacy',
  '/terms',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
];
const protectedRoutes = [
  '/dashboard',
  '/settings/billing',
  '/admin/users',
  '/settings/profile',
  '/settings/security',
  '/payment',
];

export default async function prepareDevelopmentRoutes(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (
    !baseURL ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)
  ) {
    throw new Error('E2E compilation preparation requires a loopback server');
  }

  const output = path.resolve('output/playwright', `e2e-prepare-${Date.now()}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const steps: Array<{ name: string; milliseconds: number }> = [];
  const browserErrors: string[] = [];
  const headers = { 'x-e2e-secret': E2E_TEST_SECRET };
  const owner = createE2EUser({ name: 'Development compilation fixture' });
  const api = await request.newContext({
    baseURL,
    timeout: compilationTimeout,
    extraHTTPHeaders: { Origin: baseURL },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const contexts: BrowserContext[] = [];
  let failure: unknown;

  async function measured(name: string, action: () => Promise<void>) {
    const started = Date.now();
    try {
      await action();
      if (browserErrors.length) {
        throw new Error(browserErrors.join('\n'));
      }
    } finally {
      const milliseconds = Date.now() - started;
      steps.push({ name, milliseconds });
      console.log(`[dev-compile] ${name}: ${milliseconds}ms`);
    }
  }

  async function createPage() {
    const context = await browser!.newContext({ baseURL, locale: 'en-US' });
    contexts.push(context);
    await context.tracing.start({ screenshots: true, snapshots: true });
    context.setDefaultTimeout(compilationTimeout);
    context.setDefaultNavigationTimeout(compilationTimeout);
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    return page;
  }

  async function visit(page: Page, route: string, allowTermsRedirect = false) {
    await measured(`GET ${route}`, async () => {
      const response = await page.goto(route);
      if (!response?.ok()) throw new Error(`${route} did not return 2xx`);
      await page.waitForLoadState('networkidle');
      const actual = new URL(page.url()).pathname;
      if (
        actual !== route &&
        !(allowTermsRedirect && actual === '/terms-update')
      ) {
        throw new Error(`${route} unexpectedly redirected to ${actual}`);
      }
    });
  }

  try {
    await measured(
      'verify development fixture guard and invalid filters',
      async () => {
        for (const email of ['', 'not-an-e2e-account@example.test']) {
          const rejected = await api.delete(
            `/api/e2e/users?email=${encodeURIComponent(email)}`,
            { headers }
          );
          if (rejected.status() !== 400) {
            throw new Error(
              'Development fixture or scoped cleanup guard failed'
            );
          }
        }
      }
    );
    browser = await chromium.launch();
    const guest = await createPage();
    for (const route of publicRoutes) await visit(guest, route);
    await measured('create verified preparation account', async () => {
      const signup = await api.post('/api/auth/sign-up/email', {
        data: {
          name: owner.name,
          email: owner.email,
          password: owner.password,
          callbackURL: '/dashboard',
        },
      });
      if (!signup.ok())
        throw new Error(`Preparation signup: ${signup.status()}`);
      const verified = await api.patch('/api/e2e/users', {
        headers,
        data: { email: owner.email, emailVerified: true },
      });
      if (!verified.ok()) throw new Error('Preparation verification failed');
    });

    const staff = await createPage();
    await measured('authenticate preparation account', async () => {
      const signin = await staff
        .context()
        .request.post('/api/auth/sign-in/email', {
          headers: { Origin: baseURL },
          data: { email: owner.email, password: owner.password },
        });
      if (!signin.ok())
        throw new Error(`Preparation signin: ${signin.status()}`);
    });
    await visit(staff, '/dashboard', true);
    if (new URL(staff.url()).pathname === '/terms-update') {
      await measured('accept preparation account terms', async () => {
        await staff
          .getByRole('button', { name: 'I accept', exact: true })
          .click();
        await staff.waitForURL('**/dashboard');
        await staff.waitForLoadState('networkidle');
      });
    }
    for (const route of protectedRoutes) await visit(staff, route);
  } catch (error) {
    failure = error;
  } finally {
    for (const [index, context] of contexts.entries()) {
      try {
        await context.tracing.stop(
          failure ? { path: path.join(output, `context-${index}.zip`) } : {}
        );
        if (failure) {
          await chmod(path.join(output, `context-${index}.zip`), 0o600);
        }
      } catch (error) {
        failure ??= error;
      }
      try {
        await context.close();
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      await browser?.close();
    } catch (error) {
      failure ??= error;
    }
    try {
      await measured('delete only preparation account', async () => {
        const cleanup = await api.delete(
          `/api/e2e/users?email=${encodeURIComponent(owner.email)}`,
          { headers }
        );
        if (!cleanup.ok())
          throw new Error('Preparation account cleanup failed');
      });
    } catch (error) {
      failure ??= error;
    }
    await api.dispose();
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          status: failure ? 'failed' : 'ready',
          preparationOnly: true,
          steps,
          browserErrors,
          error: failure instanceof Error ? failure.message : undefined,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.log(`[dev-compile] report: ${output}/report.json`);
  }
  if (failure) throw failure;
}
