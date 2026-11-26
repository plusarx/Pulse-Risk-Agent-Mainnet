import { tickerOfAster, type AsterOrder } from '../../../lib/aster';
import type { AsterAccountView, AsterMarket, AsterMarketStats } from '../tools/aster';

// What the chat tells the user about their perps account and about one perp market. Pure: code turns the venue's numbers into plain facts,
// the model only words them. Nothing here reads or sends anything.

type Item = { label: string; value: string };

const n = (v: string | number | undefined | null): number | null => { const x = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(x) ? x : null; };
const usd = (x: number | null, dp = 2) => (x === null ? 'unknown' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const signed = (x: number | null) => (x === null ? 'unknown' : `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(2)}`);
const px = (x: number | null) => (x === null ? 'unknown' : String(Math.round(x * 1e6) / 1e6));

export function perpsAccountItems(view: AsterAccountView, orders: AsterOrder[]): Item[] {
  if (!view.funded || !view.account) return [{ label: 'Perps account', value: 'connected, but nothing has been deposited yet: equity $0.00, no positions, no open orders' }];
  const a = view.account;
  const equity = n(a.totalMarginBalance) ?? n(a.totalWalletBalance); const free = n(a.availableBalance); const unreal = n(a.totalUnrealizedProfit); const used = equity !== null && free !== null ? Math.max(0, equity - free) : null;
  const items: Item[] = [{ label: 'Perps account', value: `equity ${usd(equity)}, free margin ${usd(free)}, margin in use ${usd(used)}${used !== null && equity ? ` (${Math.round((used / equity) * 100)}% of equity)` : ''}, unrealised profit and loss ${signed(unreal)}` }];
  const open = view.positions.filter((p) => Number(p.positionAmt) !== 0);
  for (const p of open) {
    const t = tickerOfAster(p.symbol) ?? p.symbol; const amt = Number(p.positionAmt); const mark = n(p.markPrice); const liq = n(p.liquidationPrice);
    const away = liq && liq > 0 && mark ? Math.round((Math.abs(mark - liq) / mark) * 1000) / 10 : null;
    items.push({ label: `Perps ${t} position`, value: `${amt < 0 ? 'short' : 'long'} ${Math.abs(amt)} ${t} at entry ${px(n(p.entryPrice))}, mark ${px(mark)}, notional ${usd(Math.abs(n(p.notional) ?? 0))}, leverage ${n(p.leverage) ?? 'unknown'}x, unrealised ${signed(n(p.unRealizedProfit))}, ${liq && liq > 0 ? `liquidation price ${px(liq)}${away !== null ? ` (${away}% away)` : ''}` : 'no liquidation price reported'}` });
  }
  if (!open.length) items.push({ label: 'Perps positions', value: 'none open' });
  for (const o of orders.slice(0, 8)) {
    const t = tickerOfAster(o.symbol) ?? o.symbol;
    items.push({ label: `Perps open order #${o.orderId}`, value: `${o.side === 'SELL' ? 'sell' : 'buy'} ${o.origQty} ${t} (${o.type.toLowerCase()}${o.reduceOnly ? ', reduce only' : ''}), ${o.status.toLowerCase()}${Number(o.price) > 0 ? ` at ${px(n(o.price))}` : ''}, filled ${o.executedQty}` });
  }
  if (!orders.length) items.push({ label: 'Perps open orders', value: 'none' });
  return items;
}

export function perpMarketItems(ticker: string, m: AsterMarket, st: AsterMarketStats | null, maxLeverage: number | null): Item[] {
  const items: Item[] = [{ label: `Perps ${ticker} market`, value: `${m.symbol}: minimum order $${m.minNotionalUsd} (and at least ${m.minQty} ${ticker}), size step ${m.stepSize}, price step ${m.tickSize}${maxLeverage ? `, maximum leverage ${maxLeverage}x` : ''}` }];
  if (!st) return items;
  items.push({ label: `Perps ${ticker} price`, value: `mark ${px(st.markPrice)}${st.indexPrice !== null ? `, index ${px(st.indexPrice)}` : ''}${st.change24hPct !== null ? `, 24 h move ${st.change24hPct >= 0 ? '+' : ''}${st.change24hPct.toFixed(2)}%` : ''}${st.volume24hUsd !== null ? `, 24 h volume ${usd(st.volume24hUsd, 0)}` : ''}` });
  if (st.fundingRatePct !== null) {
    const next = st.nextFundingAt ? ` The next payment is ${new Date(st.nextFundingAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.` : '';
    items.push({ label: `Perps ${ticker} funding`, value: `${st.fundingRatePct >= 0 ? '+' : ''}${st.fundingRatePct.toFixed(4)}% this interval: ${st.fundingRatePct > 0 ? 'longs pay shorts, so a short earns it' : st.fundingRatePct < 0 ? 'shorts pay longs, so a short pays it' : 'no payment either way'}.${next}` });
  }
  return items;
}
