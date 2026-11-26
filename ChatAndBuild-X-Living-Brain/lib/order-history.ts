// One row shape for past orders on every venue, and the plain-language status for each. Pure (shared by server and UI).

export type HistoryVenue = 'aster' | 'lighter' | 'derive' | 'bstocks';

export interface HistoryRow {
  venue: HistoryVenue;
  /** Unix ms. */
  time: number;
  /** e.g. 'BTC-PERP', 'ETH-20261204-1700-C', 'NVDAB'. */
  market: string;
  side: 'buy' | 'sell';
  type: string;
  size: string;
  filled: string;
  avgPrice: string | null;
  /** The venue's own status string. Lighter: 'filled' / 'canceled-…'; Derive: 'filled' or 'cancelled:insufficient_margin'; bStocks: 'filled'. */
  status: string;
  account: string | null;
  txHash: string | null;
  /** Perps (Aster) only: the venue's order id. Aster matches off-chain, so there is no tx hash; this is the reference. */
  orderId?: string | null;
  /** Options only: Derive's own trade id (a reference before the on-chain hash exists) and its settlement stage. */
  tradeId?: string | null;
  /** 'Pending' | 'Proving' | 'Settled' | 'Reverted' ... as Derive reports it (batch_status). */
  settlement?: string | null;
}

const LIGHTER_REASON: Record<string, string> = {
  'canceled-margin-not-allowed': 'not enough margin',
  'canceled-not-enough-liquidity': 'not enough liquidity on the book',
  'canceled-too-much-slippage': 'the price moved past your limit',
  'canceled-post-only': 'would have filled immediately (post-only)',
  'canceled-reduce-only': 'would have increased the position (reduce-only)',
  'canceled-expired': 'expired',
  'canceled-self-trade': 'would have traded with your own order',
  'canceled-invalid-balance': 'balance check failed',
};

const DERIVE_REASON: Record<string, string> = {
  user_request: 'canceled by you',
  insufficient_margin: 'not enough margin',
  ioc_or_market_partial_fill: 'rest of a market order not filled',
  signed_max_fee_too_low: 'fee limit too low',
  cancel_on_disconnect: 'canceled on disconnect',
  mmp_trigger: 'market-maker protection',
  session_key_deregistered: 'agent key removed',
  subaccount_withdrawn: 'subaccount emptied',
  compliance: 'compliance',
  trigger_failed: 'trigger failed',
  validation_failed: 'rejected by Derive',
};

const words = (s: string) => s.replace(/^canceled-|^cancelled-/, '').replace(/[-_]/g, ' ');

/** Short status for the table, plus whether it is good (filled), bad (nothing filled) or neutral. */
/**
 * Where a transaction can be looked up, per venue (checked live 2026-11-25):
 * bStocks on BscScan; Lighter fills in Lighter's explorer (app.lighter.xyz/explorer/logs/<hash>, the hash from its
 * trades API); Derive trades on the Derive chain's Blockscout explorer. null when no explorer is known (Derive testnet).
 */
export function txUrl(venue: HistoryVenue, hash: string, network: 'mainnet' | 'testnet' = 'mainnet'): string | null {
  if (venue === 'bstocks') return `https://bscscan.com/tx/${hash}`;
  // Aster orders are matched off-chain (no hash). Its deposits are BNB Chain transactions to the vault: BscScan.
  if (venue === 'aster') return /^0x[0-9a-fA-F]{64}$/.test(hash) && network === 'mainnet' ? `https://bscscan.com/tx/${hash}` : null;
  if (venue === 'lighter') return network === 'mainnet' ? `https://app.lighter.xyz/explorer/logs/${hash}` : `https://testnet.app.lighter.xyz/explorer/logs/${hash}`;
  return network === 'mainnet' ? `https://explorer.derive.xyz/tx/${hash.startsWith('0x') ? hash : `0x${hash}`}` : null;
}
/** Plain words for Derive's settlement stage of a trade. Live 2026-11-26: fills show batch_status "Proving" with no tx_hash yet. */
export function settlementLabel(status: string | null | undefined): string {
  const st = (status ?? '').toLowerCase();
  if (!st) return 'settling';
  if (st.includes('prov')) return 'proving on-chain';
  if (st.includes('pend') || st.includes('submit')) return 'queued to settle';
  if (st.includes('settl')) return 'settled';
  if (st.includes('revert') || st.includes('error') || st.includes('fail')) return 'settlement failed';
  return st;
}
export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

export function statusLabel(r: Pick<HistoryRow, 'venue' | 'status' | 'filled' | 'size'>): { text: string; tone: 'up' | 'down' | 'muted' } {
  const filled = Number(r.filled); const size = Number(r.size);
  const part = filled > 0 && filled < size;
  if (r.venue === 'derive') {
    const [st, reason] = r.status.split(':');
    if (st === 'filled') return { text: 'Filled', tone: 'up' };
    if (st === 'open') return { text: part ? 'Partly filled, open' : 'Open', tone: 'muted' };
    const why = reason ? DERIVE_REASON[reason] ?? words(reason) : st;
    return { text: `${part ? 'Partly filled · ' : ''}${st === 'expired' ? 'Expired' : st === 'rejected' ? 'Rejected' : 'Canceled'}${why && why !== st ? `: ${why}` : ''}`, tone: part ? 'muted' : 'down' };
  }
  if (r.venue === 'aster') {
    if (r.status === 'filled') return { text: 'Filled', tone: 'up' };
    if (r.status === 'open') return { text: part ? 'Partly filled, open' : 'Open', tone: 'muted' };
    const end = r.status === 'expired' ? 'Expired' : r.status === 'rejected' ? 'Rejected' : r.status === 'canceled' ? 'Canceled' : words(r.status);
    return { text: `${part ? 'Partly filled · ' : ''}${end}`, tone: part ? 'muted' : 'down' };
  }
  if (r.status === 'filled') return { text: 'Filled', tone: 'up' };
  if (r.status.startsWith('canceled')) {
    const why = LIGHTER_REASON[r.status] ?? words(r.status);
    return { text: `${part ? 'Partly filled · ' : ''}Canceled: ${why}`, tone: part ? 'muted' : 'down' };
  }
  return { text: words(r.status), tone: 'muted' };
}
