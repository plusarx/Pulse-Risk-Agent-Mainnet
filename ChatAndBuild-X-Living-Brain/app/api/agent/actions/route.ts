import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { clearActionHistory, listActions } from '@/lib/server/agent-actions';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ actions: listActions(wallet, n) });
  });
}

/** Clear finished requests that never ran (rejected, superseded, expired). */
export async function DELETE(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ cleared: clearActionHistory(wallet, n) });
  });
}
