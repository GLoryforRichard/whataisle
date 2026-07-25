import { timingSafeEqual } from 'node:crypto';
import { registerHandlers } from '@/jobs/handlers';
import { reclaimStuckJobs, runJobs } from '@/jobs/queue';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

/**
 * Job queue tick. Driven by Cloud Scheduler (see infra/gcp/07-scheduler.sh),
 * which is the external clock the queue needs — Cloud Run has no background
 * process of its own.
 *
 * Authenticated with ADMIN_TASK_TOKEN, the same bearer the deploy pipeline
 * already uses for re-embed. Disabled entirely when the token is unset, so a
 * misconfigured environment fails closed rather than exposing an unauthenticated
 * work endpoint.
 */
function authorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TASK_TOKEN;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return new NextResponse(null, { status: 403 });
  }

  registerHandlers();

  // Free anything a crashed tick left locked before claiming new work.
  const reclaimed = await reclaimStuckJobs();
  const summary = await runJobs(5);

  return NextResponse.json({ reclaimed, ...summary });
}
