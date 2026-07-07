import { getDb } from '@/db';
import { auditLog, store } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import { signImpersonationToken } from '@/lib/staff-auth';
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
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const port = _req.headers.get('host')?.split(':')[1];
  const base = `${protocol}://${target.handle}.${rootDomain}${port ? `:${port}` : ''}`;
  return NextResponse.redirect(
    `${base}/staff/enter?t=${encodeURIComponent(token)}`
  );
}
