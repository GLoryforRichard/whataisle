import { getDb } from '@/db';
import { auditLog, store } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import {
  IMPERSONATION_TTL_MS,
  hashImpersonationToken,
  signImpersonationToken,
} from '@/lib/staff-auth';
import { impersonationRepo } from '@/data/impersonation-repo';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Start impersonation of a store (requirements §7: "enter the store as the
 * tenant … fully audit-logged" — the only efficient way to handle "it doesn't
 * show up on my end" support cases). Founder/admin only.
 *
 * Mints a short-lived signed token and redirects to the store subdomain, which
 * sets a flagged staff cookie. The start is audit-logged; every subsequent
 * acted-on change carries isImpersonation.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const session = await getSession();
  if (session?.user?.role !== 'admin') {
    return new NextResponse(null, { status: 403 });
  }

  const { storeId } = await params;
  const db = await getDb();
  const rows = await db
    .select({ handle: store.handle })
    .from(store)
    .where(eq(store.id, storeId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return new NextResponse(null, { status: 404 });
  }

  await db.insert(auditLog).values({
    id: nanoid(),
    actorUserId: session.user.id,
    storeId,
    action: 'impersonation.start',
    targetType: 'store',
    targetId: storeId,
    isImpersonation: true,
  });

  const token = signImpersonationToken(storeId);
  // Recorded so /staff/enter can enforce single use: the token rides in a
  // redirect URL, so a signature check alone leaves it replayable for its
  // whole 60-second life by anything that saw the URL.
  await impersonationRepo().create({
    tokenHash: hashImpersonationToken(token),
    storeId,
    actorUserId: session.user.id,
    expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS),
  });
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const port = _req.headers.get('host')?.split(':')[1];
  const base = `${protocol}://${target.handle}.${rootDomain}${port ? `:${port}` : ''}`;
  return NextResponse.redirect(
    `${base}/staff/enter?t=${encodeURIComponent(token)}`
  );
}
