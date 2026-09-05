export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ enabled: process.env.WHEREBEAR_DOMAIN_CUTOVER === '1' }, { headers: { 'Cache-Control': 'no-store' } });
}
