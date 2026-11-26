import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { getDb } from '@/lib/server/db';
import { AgentEvent } from '@/lib/agent-config';

/** Agent service: append to a wallet's activity log. Idempotent on (wallet, idempotencyKey). */
export async function POST(req: Request) {
  return withAgent(async () => {
    const p = AgentEvent.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const e = p.data;
    const r = getDb().prepare(`INSERT OR IGNORE INTO agent_events (wallet, network, kind, venue, status, message, payload, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.wallet.toLowerCase(), e.network, e.kind, e.venue ?? null, e.status ?? null, e.message,
      e.payload ? JSON.stringify(e.payload) : null, e.idempotencyKey, Date.now());
    return json({ ok: true, duplicate: r.changes === 0 });
  });
}
