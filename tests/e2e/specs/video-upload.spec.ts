import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  updateE2EUser,
} from '../fixtures/auth';

/**
 * Resumable walkthrough-video upload (requirements §6: phone-shot files that
 * survive a dropped connection).
 *
 * The catalog deferred this pending "deterministic fixtures", but it needs
 * none: recordChunk is already idempotent, chunksReceived already persists,
 * and e2e.yml already runs STORAGE_PROVIDER=local. The only real constraint
 * is that /complete streams the chunks together, so they must be real bytes.
 */

const CHUNK = (marker: string) => Buffer.from(`${marker}`.repeat(64));

test.describe('resumable video upload', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a re-sent chunk is idempotent and the upload still completes', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await updateE2EUser(request, { email: user.email, hasPaid: true });

    const init = await page.request.post('/api/owner/video/init', {
      data: { filename: 'walk.mp4', totalChunks: 3 },
    });
    expect(init.ok()).toBeTruthy();
    const { videoId } = await init.json();
    expect(videoId).toBeTruthy();

    const send = (index: number, marker: string) =>
      page.request.post('/api/owner/video/chunk', {
        multipart: {
          videoId,
          chunkIndex: String(index),
          chunk: {
            name: `chunk-${index}`,
            mimeType: 'application/octet-stream',
            buffer: CHUNK(marker),
          },
        },
      });

    // Upload out of order and drop one, as a flaky phone connection would.
    expect((await send(0, 'a')).ok()).toBeTruthy();
    const afterTwo = await send(2, 'c');
    expect(afterTwo.ok()).toBeTruthy();

    // Re-send a chunk the server already has: it must not double-count.
    const replay = await send(0, 'a');
    expect(replay.ok()).toBeTruthy();
    const replayBody = await replay.json();
    expect(replayBody.received).toBe(2);

    // Completing while a chunk is missing must fail rather than stitch a
    // truncated video — the map gets drawn from this footage.
    const premature = await page.request.post('/api/owner/video/complete', {
      data: { videoId },
    });
    expect(premature.ok()).toBeFalsy();

    // Send the gap, then complete.
    expect((await send(1, 'b')).ok()).toBeTruthy();
    const done = await page.request.post('/api/owner/video/complete', {
      data: { videoId },
    });
    expect(done.ok()).toBeTruthy();
  });
});
