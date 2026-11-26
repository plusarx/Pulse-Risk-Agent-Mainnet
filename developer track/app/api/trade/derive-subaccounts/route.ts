import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { once } from '@/lib/server/idempotency';
import { enableDeriveUniverse, moveDeriveFunds } from '@/lib/server/derive';

export const runtime = 'nodejs';

const AMT = /^\d+(\.\d{1,6})?$/;

/**
 * POST { network, action: 'enable', managerId, amount }  → create + fund a subaccount for that risk universe
 * POST { network, action: 'move', from, to, amount }     → move USDC between the wallet's own subaccounts
 * Requires an Idempotency-Key header. Signed by the agent session key (scopes transfer:new/existing_subaccount).
 */
export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const idem = req.headers.get('idempotency-key');
    if (!idem || idem.length < 8 || idem.length > 80) return json({ error: 'Idempotency-Key header required' }, 400);
    const b = (await req.json().catch(() => ({}))) as { network?: string; action?: string; managerId?: number; from?: number; to?: number; amount?: string };
    const n = netParam(b.network);
    if (!n) return json({ error: 'network must be mainnet|testnet' }, 400);
    const amount = String(b.amount ?? '');
    if (!AMT.test(amount)) return json({ error: 'amount must be a USDC decimal' }, 400);
    const key = `${wallet}:derive-subs:${n}:${idem}`;
    if (b.action === 'enable') {
      if (!Number.isInteger(b.managerId) || b.managerId! <= 0) return json({ error: 'managerId required' }, 400);
      return json(await once(key, () => enableDeriveUniverse(n, wallet, b.managerId!, amount)));
    }
    if (b.action === 'move') {
      if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || b.to! <= 0) return json({ error: 'from and to subaccount ids required' }, 400);
      return json(await once(key, () => moveDeriveFunds(n, wallet, b.from!, b.to!, amount)));
    }
    return json({ error: 'action must be enable|move' }, 400);
  });
}
