import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { clearProposalHistory, listProposals } from '@/lib/server/agent-store';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ proposals: listProposals(wallet, n) });
  });
}

/** Clear the signed-in user's finished proposals (rejected, superseded, undone). Approved ones are kept. */
export async function DELETE(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ cleared: clearProposalHistory(wallet, n) });
  });
}
