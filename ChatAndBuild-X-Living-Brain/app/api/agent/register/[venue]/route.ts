import { isHex } from 'viem';
import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { finalizeLighterKey, prepareLighterKey } from '@/lib/server/lighter';
import { finalizeDeriveKey, prepareDeriveKey } from '@/lib/server/derive';
import { confirmAsterKey, prepareAsterKey } from '@/lib/server/aster';

export const runtime = 'nodejs';

/** POST { network, step: 'prepare' | 'finalize', ...signatures } */
export async function POST(req: Request, ctx: { params: Promise<{ venue: string }> }) {
  const { venue } = await ctx.params;
  return withWallet(async (wallet) => {
    const b = (await req.json().catch(() => ({}))) as { network?: string; step?: string; signature?: string; setKey?: string; whitelist?: string; login?: string };
    const n = netParam(b.network);
    if (!n) return json({ error: 'network must be mainnet|testnet' }, 400);
    if (venue === 'aster') {
      // prepare → { typedData, msg } for MetaMask signTypedData (BNB Chain); finalize → submit the approval to the venue.
      if (b.step === 'prepare') return json(await prepareAsterKey(n, wallet));
      if (b.step === 'finalize') {
        if (!b.signature || !isHex(b.signature)) return json({ error: 'signature required' }, 400);
        return json(await confirmAsterKey(n, wallet, b.signature));
      }
    }
    if (venue === 'lighter') {
      if (b.step === 'prepare') return json(await prepareLighterKey(n, wallet));
      if (b.step === 'finalize') {
        if (!b.signature || !isHex(b.signature)) return json({ error: 'signature required' }, 400);
        return json(await finalizeLighterKey(n, wallet, b.signature));
      }
    }
    if (venue === 'derive') {
      if (b.step === 'prepare') return json(await prepareDeriveKey(n, wallet));
      if (b.step === 'finalize') {
        const { setKey, whitelist, login } = b;
        if (![setKey, whitelist, login].every((s) => typeof s === 'string' && isHex(s))) return json({ error: 'three signatures required' }, 400);
        return json(await finalizeDeriveKey(n, wallet, { setKey: setKey as `0x${string}`, whitelist: whitelist as `0x${string}`, login: login as `0x${string}` }));
      }
    }
    return json({ error: 'unknown venue or step' }, 400);
  });
}
