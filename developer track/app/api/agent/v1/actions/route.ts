import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { createAction, listApprovedActions } from '@/lib/server/agent-actions';
import { netParam } from '@/lib/server/http';
import { ActionIn } from '@/lib/agent-action';

/** Agent service: ask the user for permission (confirmation mode). Stays pending until the user decides in the UI. */
export async function POST(req: Request) {
  return withAgent(async () => {
    const p = ActionIn.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    return json({ ok: true, ...createAction(p.data) });
  });
}

/** Agent service: requests the user approved and the agent has not run yet (or ?status=pending for ones still waiting). */
export async function GET(req: Request) {
  return withAgent(async () => {
    const u = new URL(req.url); const n = netParam(u.searchParams.get('network')); const wallet = u.searchParams.get('wallet') ?? '';
    if (!n || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: 'wallet, network required' }, 400);
    return json({ actions: listApprovedActions(wallet, n, u.searchParams.get('status') === 'pending' ? 'pending' : 'approved') });
  });
}
