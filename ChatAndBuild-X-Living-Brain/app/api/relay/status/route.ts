import { RELAY_API } from '@/lib/venues';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('requestId') ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return Response.json({ error: 'requestId required' }, { status: 400 });
  const r = await fetch(`${RELAY_API}/intents/status/v3?requestId=${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  return Response.json(await r.json().catch(() => ({ status: 'unknown' })), { status: r.ok ? 200 : 502 });
}
