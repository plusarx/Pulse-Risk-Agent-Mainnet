import { z } from 'zod';
import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { completeAction } from '@/lib/server/agent-actions';
import { netParam } from '@/lib/server/http';

const Body = z.object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/), status: z.enum(['executed', 'failed', 'expired']), message: z.string().min(1).max(500) });

/** Agent service: report what happened after running an approved request (the acknowledgement). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAgent(async () => {
    const { id } = await ctx.params; const n = netParam(new URL(req.url).searchParams.get('network'));
    const b = Body.safeParse(await req.json().catch(() => null));
    if (!n || !/^\d+$/.test(id) || !b.success) return json({ error: 'network, id, wallet, status and message required' }, 400);
    return json({ action: completeAction(b.data.wallet, n, Number(id), b.data.status, b.data.message) });
  });
}
