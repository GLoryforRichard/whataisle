import { NextResponse } from 'next/server';

/**
 * Compare / vision-test / cost-lab / sync /api/vision burn full-price Vertex.
 * Production leaves this off; set SCAN_LAB_ENABLED=1 locally to run labs.
 */
export function isScanLabEnabled(): boolean {
  // Experiment artifacts use the legacy release's public directory, never a customer runtime.
  if (process.env.STORE_RUNTIME_TOKEN || (process.env.STORE_ID && process.env.STORE_ID !== 'wherebear')) return false;
  const v = process.env.SCAN_LAB_ENABLED;
  return v === '1' || v === 'true';
}

export function scanLabNotFound(): NextResponse {
  return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
}
