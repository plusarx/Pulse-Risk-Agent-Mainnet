import { json } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { netParam, withWallet } from '@/lib/server/http';
import { deriveUniverses, findDeriveSubaccount, listDeriveSubaccounts } from '@/lib/server/derive';

export const runtime = 'nodejs';

/**
 * Derive account snapshot for the signed-in wallet (read with the agent key): every subaccount with its
 * risk universe, plus the universe catalogue. `subaccount` is the richest tradeable one (legacy field).
 */
export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    const universes = await deriveUniverses(n);
    const row = getDb().prepare("SELECT status FROM agent_keys WHERE wallet = ? AND venue = 'derive' AND network = ?").get(wallet.toLowerCase(), n) as { status: string } | undefined;
    if (row?.status !== 'active') {
      const sub = await findDeriveSubaccount(n, wallet);
      return json({ state: sub === null ? 'no_account' : 'needs_agent', subaccountId: sub, universes });
    }
    const subaccounts = await listDeriveSubaccounts(n, wallet);
    const primary = subaccounts.filter((s) => !s.isFallback).sort((a, b) => Number(b.collaterals_value) - Number(a.collaterals_value))[0] ?? subaccounts[0];
    return json({ state: 'ok', subaccount: primary, subaccounts, universes });
  });
}
