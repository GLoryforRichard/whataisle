import { NextRequest, NextResponse } from 'next/server';
import { canonicalLocation, classifyStoreHost, STORE_ID } from '@/lib/store-identity.mjs';

export function proxy(req: NextRequest) {
  const host = classifyStoreHost(req.headers.get('host'));
  if (host === 'foreign') {
    return NextResponse.json({ ok: false, error: 'Store not found' }, { status: 421 });
  }
  const path = req.nextUrl.pathname;
  // Old open tabs must finish same-origin uploads/SSE without cross-origin
  // redirects. Documents use the browser outbox guard on their first visit;
  // once drained the browser moves itself, retaining path and query.
  // Next.js client navigation/prefetch must also remain same-origin while a
  // phone has pending photos; redirecting an RSC fetch would break the queue.
  if (host === 'legacy' && process.env.WHEREBEAR_DOMAIN_CUTOVER === '1' && !path.startsWith('/api/') && !path.startsWith('/_next/') &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.headers.get('accept')?.includes('text/html') &&
      !req.headers.get('accept')?.includes('text/x-component') &&
      req.headers.get('rsc') !== '1' &&
      req.headers.get('next-router-prefetch') !== '1' &&
      !req.nextUrl.searchParams.has('_rsc')) {
    return NextResponse.redirect(canonicalLocation(path, req.nextUrl.search), 308);
  }
  const response = NextResponse.next();
  response.headers.set('X-WhatAisle-Store', STORE_ID);
  if (host === 'legacy') {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Link', `<${canonicalLocation(path)}>; rel="canonical"`);
  }
  return response;
}

export const config = { matcher: '/:path*' };
