import { lighterSignerHealthy } from '@/lib/server/lighter';
import { getDb } from '@/lib/server/db';

export const runtime = 'nodejs';

export async function GET() {
  const out: Record<string, string> = {};
  try { getDb().prepare('SELECT 1').get(); out.db = 'ok'; } catch (e) { out.db = (e as Error).message; }
  try { out.lighterSigner = (await lighterSignerHealthy()) ? 'ok' : 'failed'; } catch (e) { out.lighterSigner = (e as Error).message; }
  const ok = Object.values(out).every((v) => v === 'ok');
  return Response.json(out, { status: ok ? 200 : 500, headers: { 'cache-control': 'no-store' } });
}
