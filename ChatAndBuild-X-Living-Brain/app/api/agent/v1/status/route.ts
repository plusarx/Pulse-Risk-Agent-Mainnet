import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { writeStatus } from '@/lib/server/agent-status';
import { StatusIn } from '@/lib/agent-status';

/** Agent service: post the always-visible status every tick. Replaces the previous snapshot. */
export async function POST(req: Request) {
  return withAgent(async () => {
    const p = StatusIn.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    writeStatus(p.data);
    return json({ ok: true });
  });
}
