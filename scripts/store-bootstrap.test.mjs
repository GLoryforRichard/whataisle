import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  BOOTSTRAP_FILES,
  CADDY_IMPORT,
  mergedCaddy,
  mergedPlatformEnv,
  validateGeminiAuth,
} from './store-stage-bootstrap.mjs';
import { newState, renderEnv, sha256 } from './store-provisioning-core.mjs';

const fields = {
  STRIPE_PRICE_USD_MONTH: 'price_usdmonth',
  STRIPE_PRICE_USD_YEAR: 'price_usdyear',
  STRIPE_PRICE_CAD_MONTH: 'price_cadmonth',
  STRIPE_PRICE_CAD_YEAR: 'price_cadyear',
  STRIPE_PRICE_CAD_TEST_MONTH: 'price_cadtest',
  STORE_BILLING_TEST_EMAILS: 'fixture@example.test',
};

const account = 'fixture@wherebear-prod-20260902.iam.gserviceaccount.com';
const cloudScope = 'https://www.googleapis.com/auth/cloud-platform';
const adc = {
  mode: 'vertex-adc',
  serviceAccountEmail: account,
  permissionsVerified: true,
};
const adcWorker = {
  platformUrl: 'https://www.whataisle.com',
  atlasHost: 'fixture.mongodb.net',
  commonRuntimeEnv: {
    GOOGLE_CLOUD_PROJECT: 'wherebear-prod-20260902',
    OPENROUTER_API_KEY: 'fixture-openrouter',
  },
};
const keyWorker = {
  ...adcWorker,
  commonRuntimeEnv: {
    ...adcWorker.commonRuntimeEnv,
    GEMINI_API_KEY: 'fixture-gemini',
  },
};

function metadataFixture(email = account, scopes = cloudScope) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      const field = url.split('/').at(-1);
      assert.ok(['email', 'scopes'].includes(field));
      assert.equal(
        url,
        `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${field}`
      );
      assert.equal(options.headers['Metadata-Flavor'], 'Google');
      assert.equal(options.redirect, 'error');
      calls.push(field);
      return new Response(field === 'email' ? email : scopes, {
        headers: { 'Metadata-Flavor': 'Google' },
      });
    },
  };
}

test('Gemini bootstrap defaults to explicit API keys without fetching VM metadata', async () => {
  const noNetwork = () => assert.fail('API-key mode must not call metadata');
  assert.deepEqual(await validateGeminiAuth(undefined, keyWorker, noNetwork), {
    mode: 'api-key',
  });
  assert.deepEqual(
    await validateGeminiAuth({ mode: 'api-key' }, keyWorker, noNetwork),
    { mode: 'api-key' }
  );
  await assert.rejects(
    validateGeminiAuth(undefined, adcWorker, noNetwork),
    /requires a configured Gemini API key/
  );
});

test('both Gemini modes require OpenRouter and the approved runtime project', async () => {
  const noNetwork = () => assert.fail('Reject configuration before metadata');
  for (const [auth, worker] of [
    [undefined, keyWorker],
    [adc, adcWorker],
  ]) {
    for (const missing of ['', ' ', undefined]) {
      await assert.rejects(
        validateGeminiAuth(
          auth,
          {
            ...worker,
            commonRuntimeEnv: {
              ...worker.commonRuntimeEnv,
              OPENROUTER_API_KEY: missing,
            },
          },
          noNetwork
        ),
        /OpenRouter/
      );
    }
    await assert.rejects(
      validateGeminiAuth(
        auth,
        {
          ...worker,
          commonRuntimeEnv: {
            ...worker.commonRuntimeEnv,
            GOOGLE_CLOUD_PROJECT: 'wrong-project',
          },
        },
        noNetwork
      ),
      /approved target/
    );
  }
});

test('ADC requires operator-verified permissions and rejects key/ADC mixtures before metadata', async () => {
  const noNetwork = () => assert.fail('Unreviewed ADC must not query metadata');
  for (const permissionsVerified of [undefined, false, 'true']) {
    await assert.rejects(
      validateGeminiAuth({ ...adc, permissionsVerified }, adcWorker, noNetwork),
      /reviewed IAM\/API/
    );
  }
  for (const serviceAccountEmail of [
    undefined,
    '',
    'owner@example.com',
    `${account}\n`,
  ]) {
    await assert.rejects(
      validateGeminiAuth({ ...adc, serviceAccountEmail }, adcWorker, noNetwork),
      /reviewed IAM\/API/
    );
  }
  for (const GEMINI_API_KEY of ['fixture', '', undefined]) {
    await assert.rejects(
      validateGeminiAuth(
        adc,
        {
          ...adcWorker,
          commonRuntimeEnv: { ...adcWorker.commonRuntimeEnv, GEMINI_API_KEY },
        },
        noNetwork
      ),
      /must omit GEMINI_API_KEY/
    );
  }
});

test('reviewed ADC verifies the current email/scope and renders a Vertex-only runtime', async () => {
  const fixture = metadataFixture(`${account}\n`, `${cloudScope}\n`);
  assert.deepEqual(
    await validateGeminiAuth(adc, adcWorker, fixture.fetch),
    adc
  );
  assert.deepEqual(fixture.calls.sort(), ['email', 'scopes']);
  const env = renderEnv(
    newState(
      {
        jobId: 'auth-test',
        storeId: 'auth-test',
        handle: 'authtest',
      },
      3101
    ),
    adcWorker
  );
  assert.ok(env.includes('GOOGLE_CLOUD_PROJECT="wherebear-prod-20260902"'));
  assert.ok(env.includes('OPENROUTER_API_KEY="fixture-openrouter"'));
  assert.ok(!env.includes('GEMINI_API_KEY='));
  assert.ok(!env.includes('GOOGLE_APPLICATION_CREDENTIALS='));
});

test('reviewed ADC refuses a changed service identity or insufficient OAuth scope', async () => {
  for (const fixture of [
    metadataFixture(
      'different@wherebear-prod-20260902.iam.gserviceaccount.com'
    ),
    metadataFixture(
      account,
      'https://www.googleapis.com/auth/devstorage.read_write'
    ),
    metadataFixture(account, `${cloudScope}.not-the-same`),
  ]) {
    await assert.rejects(
      validateGeminiAuth(adc, adcWorker, fixture.fetch),
      /differs from review/
    );
  }
});

test('ADC metadata failure or missing provenance refuses safely without exposing provider text', async () => {
  for (const fetch of [
    async () => {
      throw new Error('fixture-sensitive-provider-detail');
    },
    async () =>
      new Response('fixture-sensitive-provider-detail', { status: 403 }),
    async () => new Response(account),
  ]) {
    await assert.rejects(validateGeminiAuth(adc, adcWorker, fetch), (error) => {
      assert.equal(
        error.message,
        'Current VM ADC identity metadata is unavailable'
      );
      return true;
    });
  }
});

test('Gemini auth configuration rejects unknown modes and ambiguous extra fields', async () => {
  const noNetwork = () => assert.fail('Malformed mode must not call metadata');
  for (const auth of [
    null,
    {},
    { mode: 'metadata' },
    { ...adc, unexpected: true },
    { mode: 'api-key', permissionsVerified: true },
  ]) {
    await assert.rejects(validateGeminiAuth(auth, keyWorker, noNetwork));
  }
});

test('bootstrap appends only the import and preserves every existing route byte', () => {
  const source =
    '# original\nwherebear.help {\n  reverse_proxy localhost:3002\n}\n';
  const result = mergedCaddy(source, sha256(source));
  assert.equal(result, `${source}\n${CADDY_IMPORT}\n`);
  assert.throws(() => mergedCaddy(`${source}# unrelated edit`, sha256(source)));
});

test('platform candidate retains unrelated settings and shares only one new worker token', () => {
  const original =
    '# existing\nDATABASE_URL="fixture-only"\nSTRIPE_SECRET_KEY="unchanged"\n';
  const result = mergedPlatformEnv(original, fields, 'a'.repeat(64));
  assert.ok(result.startsWith(original));
  assert.equal(result.match(/PROVISIONING_WORKER_TOKEN=/g).length, 1);
  assert.equal(result.match(/STRIPE_SECRET_KEY=/g).length, 1);
  assert.ok(result.includes(`PROVISIONING_WORKER_TOKEN="${'a'.repeat(64)}"`));
});

test('bootstrap refuses changing old secrets, existing new values, placeholders and line injection', () => {
  assert.throws(() =>
    mergedPlatformEnv(
      '',
      { ...fields, STRIPE_SECRET_KEY: 'changed' },
      'a'.repeat(64)
    )
  );
  assert.throws(() =>
    mergedPlatformEnv(
      'STRIPE_PRICE_USD_MONTH="price_existing"\n',
      fields,
      'a'.repeat(64)
    )
  );
  assert.throws(() =>
    mergedPlatformEnv(
      'PROVISIONING_WORKER_TOKEN="existing"\n',
      fields,
      'a'.repeat(64)
    )
  );
  for (const value of [
    'price_BAD_VALUE',
    'price_REPLACE',
    'price_valid\nKEY=bad',
  ])
    assert.throws(() =>
      mergedPlatformEnv(
        '',
        { ...fields, STRIPE_PRICE_USD_MONTH: value },
        'a'.repeat(64)
      )
    );
});

test('asset allowlist excludes existing platform, backup and PM2 units', () => {
  assert.equal(BOOTSTRAP_FILES.length, 8);
  for (const { destination } of BOOTSTRAP_FILES) {
    assert.ok(!destination.includes('pm2'));
    assert.ok(!destination.includes('whataisle-platform.service'));
    assert.ok(!destination.includes('postgres-backup'));
  }
});

test('both default review CLIs complete locally without root or production credentials', () => {
  for (const [binary, args] of [
    [process.execPath, ['scripts/store-stage-bootstrap.mjs', '--review']],
    ['python3', ['scripts/store-install-bootstrap.py', '--review']],
  ]) {
    const result = spawnSync(binary, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /whataisle|store/i);
    assert.ok(!result.stdout.includes('sk_live_'));
  }
});
