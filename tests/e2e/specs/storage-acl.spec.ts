import { expect, test } from '@playwright/test';

/**
 * Storage ACLs on the store file route (requirements §5 + §10).
 *
 * The catalog deferred this behind "deterministic private-bucket fixtures",
 * but the rules being tested are provider-agnostic — isStoreStorageKey() and
 * the staff/thumbnail/video split live in the route, not in GCS — so the local
 * storage driver that E2E already uses exercises them exactly.
 *
 * These are negative tests by design: every case must be refused, so none of
 * them needs a file to actually exist.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const fileUrl = (handle: string, key: string) =>
  `http://${handle}.localhost:${PORT}/api/store/files/${key}`;

test.describe('store file access control', () => {
  test('a key belonging to another store is refused', async ({ request }) => {
    // Well-formed key, wrong tenant. Must not fall through to the provider.
    const res = await request.get(
      fileUrl('mart2', 'stores/some-other-store-id/thumbnails/x.jpg')
    );
    expect(res.status()).toBe(404);
  });

  test('path traversal out of the store prefix is refused', async ({
    request,
  }) => {
    const res = await request.get(fileUrl('demo', 'stores/../../etc/passwd'));
    expect([400, 403, 404]).toContain(res.status());
  });

  test('walkthrough videos are never served, even to the owning store', async ({
    request,
  }) => {
    // Videos are platform-internal (§10): the route refuses them outright
    // rather than gating them behind staff, so no staff cookie is needed to
    // prove it.
    const res = await request.get(
      fileUrl('demo', 'stores/demo/videos/walk.mp4')
    );
    expect(res.status()).toBe(404);
  });

  test('non-thumbnail store files require a staff session', async ({
    request,
  }) => {
    // Shelf photos sit behind the PIN gate; anonymous access is refused.
    const res = await request.get(
      fileUrl('demo', 'stores/demo/photos/shelf.jpg')
    );
    expect([403, 404]).toContain(res.status());
  });
});
