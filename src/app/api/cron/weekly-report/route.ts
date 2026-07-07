import { insightsRepo } from '@/data/insights-repo';
import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import { store, weeklyReport } from '@/db/store.schema';
import { sendEmail } from '@/mail';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

/**
 * Weekly report — the key churn-prevention touchpoint (requirements §4.3).
 * Owners don't log into dashboards; this email proves ongoing value.
 *
 * Protected by HTTP Basic auth (CRON_JOBS_USERNAME/PASSWORD). In production a
 * Cloud Scheduler job hits this weekly. Idempotent per (store, week).
 */
function unauthorized() {
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="cron"' },
  });
}

function checkAuth(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  return (
    !!process.env.CRON_JOBS_USERNAME &&
    u === process.env.CRON_JOBS_USERNAME &&
    p === process.env.CRON_JOBS_PASSWORD
  );
}

/** Monday of the current week, as YYYY-MM-DD. */
function weekStart(now: Date): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function reportHtml(input: {
  storeName: string;
  searches: number;
  hitRate: number;
  topSearches: Array<{ query: string; total: number }>;
  missCount: number;
  productCount: number;
  corrections: number;
  storeUrl: string;
}): string {
  const top = input.topSearches
    .slice(0, 5)
    .map((s) => `<li>${escapeHtml(s.query)} — ${s.total}×</li>`)
    .join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
    <h2>${escapeHtml(input.storeName)} — this week</h2>
    <p><strong>${input.searches}</strong> shopper searches ·
       <strong>${Math.round(input.hitRate * 100)}%</strong> found what they wanted</p>
    <p>Your store memory now holds <strong>${input.productCount}</strong> products.
       <strong>${input.corrections}</strong> errors were corrected this week.</p>
    ${top ? `<h3>Top searches</h3><ul>${top}</ul>` : ''}
    ${input.missCount > 0 ? `<p><strong>${input.missCount}</strong> products shoppers couldn't find — a few taps to scan them fixes that.</p>` : ''}
    <p><a href="${input.storeUrl}">Open your store</a></p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  );
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();

  const db = await getDb();
  const stores = await db
    .select({
      id: store.id,
      handle: store.handle,
      displayName: store.displayName,
      ownerEmail: user.email,
    })
    .from(store)
    .innerJoin(user, eq(store.ownerUserId, user.id))
    .where(eq(store.status, 'active'));

  const wk = weekStart(new Date());
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
  let sent = 0;
  let skipped = 0;

  for (const s of stores) {
    const repo = insightsRepo(s.id);
    const [hr, top, misses, health, corrections] = await Promise.all([
      repo.hitRate(7),
      repo.topSearches(7, 5),
      repo.missLists(50),
      repo.health(),
      repo.correctionsThisWeek(),
    ]);

    const stats = {
      searches: hr.total,
      hitRate: hr.rate,
      productCount: health.productCount,
      missCount: misses.needsScan.length + misses.notCarried.length,
      corrections,
    };

    try {
      await db.insert(weeklyReport).values({
        id: nanoid(),
        storeId: s.id,
        weekStart: wk,
        statsJson: stats,
      });
    } catch {
      // Unique violation → already sent this week; skip.
      skipped++;
      continue;
    }

    await sendEmail({
      to: s.ownerEmail,
      subject: `${s.displayName}: your weekly WhatAisle report`,
      html: reportHtml({
        storeName: s.displayName,
        searches: hr.total,
        hitRate: hr.rate,
        topSearches: top,
        missCount: stats.missCount,
        productCount: health.productCount,
        corrections,
        storeUrl: `https://${s.handle}.${rootDomain}`,
      }),
    });
    sent++;
  }

  return NextResponse.json({ ok: true, sent, skipped });
}
