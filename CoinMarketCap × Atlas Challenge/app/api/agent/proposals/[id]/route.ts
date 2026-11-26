import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { decideProposal } from '@/lib/server/agent-store';

/** The signed-in user approves or rejects one proposal. Approve applies the rule and arms automation; revert undoes an approval. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withWallet(async (wallet) => {
    const { id } = await ctx.params;
    const n = netParam(new URL(req.url).searchParams.get('network'));
    const b = (await req.json().catch(() => ({}))) as { decision?: string };
    if (!n || !/^\d+$/.test(id) || (b.decision !== 'approve' && b.decision !== 'reject' && b.decision !== 'revert')) return json({ error: 'network, id and decision (approve|reject|revert) required' }, 400);
    return json({ proposal: decideProposal(wallet, n, Number(id), b.decision) });
  });
}
