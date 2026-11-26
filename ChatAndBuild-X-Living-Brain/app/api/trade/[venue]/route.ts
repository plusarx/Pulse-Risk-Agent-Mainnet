import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { once } from '@/lib/server/idempotency';
import { cancelLighterOrder, lighterOrderOutcome, placeLighterOrder } from '@/lib/server/lighter';
import { cancelDeriveOrder, placeDeriveOrder } from '@/lib/server/derive';
import { asterOrderOutcome, cancelAsterOrder, placeAsterOrder, setAsterLeverage } from '@/lib/server/aster';

export const runtime = 'nodejs';

const DEC = /^\d+(\.\d+)?$/;
const TICKER = /^[A-Z0-9]{1,15}$/;

/**
 * GET /api/trade/aster?network=&ticker=&orderId= → what happened to that perps order (fill, open, canceled).
 * GET /api/trade/lighter?network=&marketId=&clientOrderIndex=[&accountIndex=] → what happened to that order
 * (sendTx only says Lighter accepted it; the fill or the cancel reason comes later).
 */
export async function GET(req: Request, ctx: { params: Promise<{ venue: string }> }) {
  const { venue } = await ctx.params;
  return withWallet(async (wallet) => {
    const q = new URL(req.url).searchParams;
    const n = netParam(q.get('network'));
    if (venue === 'aster') {
      const ticker = (q.get('ticker') ?? '').toUpperCase(); const orderId = q.get('orderId') ?? '';
      if (!n || !TICKER.test(ticker) || !/^\d+$/.test(orderId)) return json({ error: 'network, ticker, orderId required' }, 400);
      return json(await asterOrderOutcome(n, wallet, ticker, orderId));
    }
    if (venue !== 'lighter') return json({ error: 'order status is only available for aster and lighter' }, 400);
    const marketId = Number(q.get('marketId')); const clientOrderIndex = Number(q.get('clientOrderIndex'));
    const acct = q.get('accountIndex');
    if (!n || !Number.isInteger(marketId) || !Number.isSafeInteger(clientOrderIndex) || clientOrderIndex <= 0) return json({ error: 'network, marketId, clientOrderIndex required' }, 400);
    return json(await lighterOrderOutcome(n, wallet, marketId, clientOrderIndex, acct !== null && /^\d+$/.test(acct) ? Number(acct) : undefined));
  });
}

/**
 * POST { network, action: 'order' | 'cancel', ... } with header Idempotency-Key.
 * Orders are signed server-side by the wallet's registered agent key — no MetaMask popup per order.
 */
export async function POST(req: Request, ctx: { params: Promise<{ venue: string }> }) {
  const { venue } = await ctx.params;
  return withWallet(async (wallet) => {
    const idem = req.headers.get('idempotency-key');
    if (!idem || idem.length < 8 || idem.length > 80) return json({ error: 'Idempotency-Key header required' }, 400);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const n = netParam(b.network as string);
    if (!n) return json({ error: 'network must be mainnet|testnet' }, 400);
    const side = b.side === 'buy' || b.side === 'sell' ? b.side : null;
    const type = b.type === 'market' || b.type === 'limit' ? b.type : null;
    const key = `${wallet}:${venue}:${n}:${idem}`;

    if (venue === 'aster') {
      const ticker = String(b.ticker ?? '').toUpperCase();
      if (b.action === 'order') {
        const size = String(b.size ?? ''); const price = b.price !== undefined && b.price !== null && b.price !== '' ? String(b.price) : undefined;
        if (!side || !type || !TICKER.test(ticker) || !DEC.test(size) || (type === 'limit' && (!price || !DEC.test(price)))) return json({ error: 'ticker, side, type, size (and price for limit) required' }, 400);
        return json(await once(key, () => placeAsterOrder(n, wallet, { ticker, side, type, size, price: type === 'limit' ? price : undefined, reduceOnly: !!b.reduceOnly })));
      }
      if (b.action === 'cancel') {
        if (!TICKER.test(ticker) || typeof b.orderId !== 'string' || !/^\d+$/.test(b.orderId)) return json({ error: 'ticker, orderId required' }, 400);
        return json(await once(key, () => cancelAsterOrder(n, wallet, ticker, b.orderId as string)));
      }
      if (b.action === 'leverage') {
        const lev = Number(b.leverage);
        if (!TICKER.test(ticker) || !Number.isInteger(lev) || lev < 1 || lev > 200) return json({ error: 'ticker and a whole-number leverage required' }, 400);
        return json(await once(key, () => setAsterLeverage(n, wallet, ticker, lev)));
      }
    }
    if (venue === 'lighter') {
      if (b.action === 'order') {
        const size = String(b.size ?? ''); const price = String(b.price ?? '');
        if (!side || !type || !DEC.test(size) || !DEC.test(price) || !Number.isInteger(b.marketId)) return json({ error: 'marketId, side, type, size, price required' }, 400);
        const accountIndex = Number.isInteger(b.accountIndex) ? (b.accountIndex as number) : undefined;
        return json(await once(key, () => placeLighterOrder(n, wallet, { marketId: b.marketId as number, side, type, size, price, reduceOnly: !!b.reduceOnly, postOnly: !!b.postOnly, accountIndex })));
      }
      if (b.action === 'cancel') {
        if (!Number.isInteger(b.marketId) || !Number.isInteger(b.orderIndex)) return json({ error: 'marketId, orderIndex required' }, 400);
        return json(await once(key, () => cancelLighterOrder(n, wallet, b.marketId as number, b.orderIndex as number, Number.isInteger(b.accountIndex) ? (b.accountIndex as number) : undefined)));
      }
    }
    if (venue === 'derive') {
      if (b.action === 'order') {
        const amount = String(b.amount ?? ''); const limitPrice = b.limitPrice ? String(b.limitPrice) : undefined;
        if (!side || !type || typeof b.instrument !== 'string' || !DEC.test(amount) || (limitPrice && !DEC.test(limitPrice))) return json({ error: 'instrument, side, type, amount required' }, 400);
        return json(await once(key, () => placeDeriveOrder(n, wallet, { instrument: b.instrument as string, side, type, amount, limitPrice, reduceOnly: !!b.reduceOnly, postOnly: !!b.postOnly })));
      }
      if (b.action === 'cancel') {
        if (typeof b.instrument !== 'string' || typeof b.orderId !== 'string') return json({ error: 'instrument, orderId required' }, 400);
        return json(await once(key, () => cancelDeriveOrder(n, wallet, b.instrument as string, b.orderId as string)));
      }
    }
    return json({ error: 'unknown venue or action' }, 400);
  });
}
