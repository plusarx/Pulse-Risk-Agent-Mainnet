import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { decideAction } from '@/lib/server/agent-actions';

/** The signed-in user approves or rejects one request the agent made in confirmation mode. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withWallet(async (wallet) => {
    const { id } = await ctx.params;
    const n = netParam(new URL(req.url).searchParams.get('network'));
    const b = (await req.json().catch(() => ({}))) as { decision?: string };
    if (!n || !/^\d+$/.test(id) || (b.decision !== 'approve' && b.decision !== 'reject')) return json({ error: 'network, id and decision (approve|reject) required' }, 400);
    return json({ action: decideAction(wallet, n, Number(id), b.decision) });
  });
}
