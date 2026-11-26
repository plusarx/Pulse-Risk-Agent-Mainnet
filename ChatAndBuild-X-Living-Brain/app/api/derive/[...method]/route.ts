import { DERIVE } from '@/lib/venues';
import { netParam } from '@/lib/server/http';
import { cached } from '@/lib/server/cache';

// Public Derive JSON-RPC proxy (browser REST is CORS-blocked). Allowlisted read-only methods.
const ALLOW: Record<string, number> = {
  'public/get_all_currencies': 30_000, 'public/get_all_live_instruments': 60_000, 'public/get_all_instruments': 30_000, 'public/get_instrument': 30_000,
  'public/get_ticker': 1_000, 'public/get_tickers': 2_000, 'public/get_tradingview_chart_data': 5_000,
  'public/get_trade_history': 2_000, 'public/get_risk_universes': 60_000, 'public/get_subaccounts': 3_000,
  'public/get_pending_deposits': 5_000, 'public/get_time': 1_000, 'public/order_quote': 1_000,
};

export async function POST(req: Request, ctx: { params: Promise<{ method: string[] }> }) {
  const method = (await ctx.params).method.join('/');
  const ttl = ALLOW[method];
  if (ttl === undefined) return Response.json({ error: 'not allowed' }, { status: 404 });
  const n = netParam(new URL(req.url).searchParams.get('network')) ?? 'mainnet';
  const body = await req.text();
  if (body.length > 4_000) return Response.json({ error: 'body too large' }, { status: 413 });
  try {
    const data = await cached(`${n}:${method}:${body}`, ttl, async () => {
      // Instrument lists are large (≈435 KB for ETH options on testnet) — allow time for the body.
      const r = await fetch(`${DERIVE[n].rest}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body || '{}', signal: AbortSignal.timeout(30_000), cache: 'no-store' });
      const json = (await r.json()) as { result?: { instruments?: Record<string, unknown>[] } };
      // Slim the instrument list to what the UI uses.
      if (method === 'public/get_all_instruments' && json.result?.instruments) {
        json.result.instruments = json.result.instruments
          .filter((i) => i.is_active)
          .map((i) => ({ instrument_name: i.instrument_name, is_active: i.is_active, option_details: i.option_details, tick_size: i.tick_size, minimum_amount: i.minimum_amount, amount_step: i.amount_step }));
      }
      if (!r.ok) throw new Error(`derive HTTP ${r.status}`); // never cache failures
      return { status: r.status, body: json };
    });
    return Response.json(data.body, { status: data.status });
  } catch (e) {
    return Response.json({ error: { code: 502, message: (e as Error).message } }, { status: 502 });
  }
}
