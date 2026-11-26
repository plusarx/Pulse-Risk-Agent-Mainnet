import { isHex } from 'viem';
import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { once } from '@/lib/server/idempotency';
import { createLighterSubaccount, finalizeLighterSubKey, listLighterAccounts, prepareLighterSubKey, transferLighter } from '@/lib/server/lighter';

export const runtime = 'nodejs';

/** The wallet's Lighter accounts (master + sub-accounts), balances, and whether the agent key is on each. */
export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ accounts: await listLighterAccounts(n, wallet) });
  });
}

/**
 * POST { network, action, ... }
 *  create                              → new sub-account (agent key on master signs; no MetaMask)
 *  move { from, to, amount }           → USDC between the wallet's own accounts (agent key on `from`)
 *  enableAgent { index }               → returns messageToSign for MetaMask (registers the same agent key on the sub)
 *  enableAgentFinalize { signature }   → submits it
 * create/move need an Idempotency-Key header.
 */
export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const b = (await req.json().catch(() => ({}))) as { network?: string; action?: string; from?: number; to?: number; amount?: string; index?: number; signature?: string };
    const n = netParam(b.network);
    if (!n) return json({ error: 'network must be mainnet|testnet' }, 400);
    const idem = req.headers.get('idempotency-key') ?? '';
    const needIdem = b.action === 'create' || b.action === 'move';
    if (needIdem && (idem.length < 8 || idem.length > 80)) return json({ error: 'Idempotency-Key header required' }, 400);
    const key = `${wallet}:lighter-accts:${n}:${idem}`;
    switch (b.action) {
      case 'create':
        return json(await once(key, () => createLighterSubaccount(n, wallet)));
      case 'move':
        if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || !/^\d+(\.\d{1,6})?$/.test(String(b.amount ?? ''))) return json({ error: 'from, to, amount required' }, 400);
        return json(await once(key, () => transferLighter(n, wallet, b.from!, b.to!, String(b.amount))));
      case 'enableAgent':
        if (!Number.isInteger(b.index)) return json({ error: 'index required' }, 400);
        return json(await prepareLighterSubKey(n, wallet, b.index!));
      case 'enableAgentFinalize':
        if (!b.signature || !isHex(b.signature)) return json({ error: 'signature required' }, 400);
        return json(await finalizeLighterSubKey(n, wallet, b.signature));
      default:
        return json({ error: 'unknown action' }, 400);
    }
  });
}
