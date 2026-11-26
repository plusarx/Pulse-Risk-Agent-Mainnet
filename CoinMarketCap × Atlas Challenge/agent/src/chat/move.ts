import { createHash } from 'node:crypto';
import type { ActionPost } from '../tools/appApi';
import type { SubaccountView } from '../tools/derive';
import type { Snapshot } from '../types';

// Margin the user asks to move between their own Derive subaccounts ("move 200 from my NVDA account to main"). Like a chat trade, the chat only
// posts a request; nothing moves until the user presses Approve, and on approval the live agent re-checks everything against fresh balances.

export interface ChatMoveSpec {
  venue: 'derive'; fromId: number; /** 0 = create a new subaccount under `newManager` (enables a risk universe) */ toId: number; fromLabel: string; toLabel: string;
  /** USDC, at most 2 decimals */ amountUsd: string;
  /** Manager of the new subaccount when toId is 0 (Derive SM manager of the universe). */ newManager?: number;
}

export const MIN_MOVE_USD = 1;
export const usdcOf = (s: SubaccountView) => Number(s.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? 0);
/** Free margin: what is left after positions and open orders (Derive reports it as initial_margin). */
// The fallback has no margin manager, so Derive reports 0 initial margin even when it holds USDC (live 2026-11-26: $7 there
// looked unmovable). With no positions and no open orders nothing is reserved, so all of its USDC is free.
export const freeOf = (s: SubaccountView) => {
  const idle = !s.positions.length && !((s as { open_orders?: unknown[] }).open_orders?.length);
  return s.isFallback || idle ? Math.max(Number(s.initial_margin) || 0, usdcOf(s)) : Number(s.initial_margin);
};
// The fallback subaccount only catches mis-routed deposits and cannot trade; it is never called "main" (live 2026-11-26: a move
// labelled "to main account" parked $7 there).
export const subLabel = (s: SubaccountView) => `${s.isFallback ? 'fallback subaccount' : `${s.universeName ?? 'subaccount'} subaccount`} #${s.subaccount_id}${s.isFallback ? ' (cannot trade)' : ''}`;
export const describeSubs = (subs: SubaccountView[]) => subs.map((s) => `${subLabel(s)}: ${usdcOf(s).toFixed(2)} USDC, ${Math.max(0, freeOf(s)).toFixed(2)} free${s.positions.length ? `, positions ${s.positions.map((p) => p.instrument_name).slice(0, 4).join(', ')}` : ', no positions'}`).join('; ');

/** What the user called an account -> one of their subaccounts: an id (#123456), "main", a universe name (RWA, PRIME...), or a ticker they hold there (NVDA). */
export function resolveSub(subs: SubaccountView[], ref: string, mainId?: number | null): SubaccountView {
  const r = ref.trim().toUpperCase().replace(/^#/, '').replace(/^MY\s+/, '').replace(/\s*(SUB)?ACCOUNT$/, '').trim();
  const fail = (why: string): never => { throw new Error(`${why}. Your Derive subaccounts: ${describeSubs(subs)}`); };
  if (/^\d+$/.test(r)) return subs.find((s) => s.subaccount_id === Number(r)) ?? fail(`"${ref}" is not one of your Derive subaccounts`);
  // "main" = the subaccount the agent key was registered for (Derive's primary, e.g. PRIME), never the fallback.
  if (['MAIN', 'DEFAULT', 'MAIN ACCOUNT', 'PRIMARY'].includes(r)) { const m = subs.find((s) => s.subaccount_id === mainId && !s.isFallback); return m ?? fail('I could not tell which one is your main account; name it by universe (PRIME, RWA) or number'); }
  if (['FALLBACK', 'FALLBACK ACCOUNT'].includes(r)) { const m = subs.filter((s) => s.isFallback); return m.length === 1 ? m[0] : fail('I could not find your fallback subaccount'); }
  const byUniverse = subs.filter((s) => s.universeName?.toUpperCase() === r);
  if (byUniverse.length === 1) return byUniverse[0];
  if (byUniverse.length > 1) fail(`More than one subaccount is in the ${r} universe`);
  const byTicker = subs.filter((s) => s.positions.some((p) => p.instrument_name.toUpperCase().startsWith(`${r}-`)));
  if (byTicker.length === 1) return byTicker[0];
  if (byTicker.length > 1) fail(`${r} positions are in more than one subaccount`);
  return fail(`I could not match "${ref}" to a subaccount`);
}

/** Every reason this move cannot go ahead right now, in plain words. Empty = ok. Used when the request is made and again when it is approved. */
export function moveProblems(subs: SubaccountView[], spec: ChatMoveSpec, limits: { killSwitch: boolean; maxNotionalPerTradeUsd: number }): string[] {
  const out: string[] = []; const from = subs.find((s) => s.subaccount_id === spec.fromId); const to = subs.find((s) => s.subaccount_id === spec.toId); const amt = Number(spec.amountUsd);
  if (limits.killSwitch) out.push('the kill switch is on: no new orders or transfers');
  const creating = spec.toId === 0;
  if (!from) out.push(`subaccount #${spec.fromId} is not yours`);
  if (creating) {
    if (!spec.newManager || spec.newManager <= 0) out.push('no Derive manager was given for the new subaccount');
    const have = subs.find((x) => x.manager_id === spec.newManager && !x.isFallback);
    if (have) out.push(`you already have that subaccount (#${have.subaccount_id}); move funds into it instead`);
  } else if (!to) out.push(`subaccount #${spec.toId} is not yours`);
  if (spec.fromId === spec.toId) out.push('the source and destination are the same account');
  if (to?.isFallback) out.push(`#${spec.toId} is the fallback subaccount: it cannot trade, so margin moved there is idle. Choose PRIME or RWA`);
  if (!/^\d+(\.\d{1,2})?$/.test(spec.amountUsd) || !(amt >= MIN_MOVE_USD)) out.push(`the amount must be at least ${MIN_MOVE_USD} USDC`);
  if (amt > limits.maxNotionalPerTradeUsd) out.push(`$${amt} is over your per-move cap of $${limits.maxNotionalPerTradeUsd}`);
  if (from) {
    if (from.is_under_liquidation) out.push(`${subLabel(from)} is being liquidated`);
    if (usdcOf(from) < amt) out.push(`${subLabel(from)} holds only ${usdcOf(from).toFixed(2)} USDC`);
    else if (freeOf(from) < amt) out.push(`only ${Math.max(0, freeOf(from)).toFixed(2)} USDC is free in ${subLabel(from)}; the rest backs its open positions`);
  }
  return out;
}

export function moveRequest(s: Snapshot, spec: ChatMoveSpec, now = Date.now(), opts: { origin?: 'chat' | 'rule'; why?: string } = {}): ActionPost {
  const creating = spec.toId === 0;
  const origin = opts.origin ?? 'chat';
  const key = `act-move-${createHash('sha256').update(`${s.wallet.toLowerCase()}|${s.network}|${spec.fromId}|${spec.toId}|${spec.newManager ?? 0}|${spec.amountUsd}|${origin}|${Math.floor(now / 600_000)}`).digest('hex').slice(0, 20)}`;
  const asked = origin === 'chat' ? ' (you asked in chat)' : '';
  return {
    wallet: s.wallet, network: s.network, kind: 'top_up', venue: 'derive', origin, slot: `${creating ? 'chat-enable' : 'chat-move'}:derive:${spec.fromId}:${creating ? `m${spec.newManager}` : spec.toId}`.slice(0, 60),
    title: (creating ? `Enable ${spec.toLabel} on Derive, funded with $${spec.amountUsd} USDC from ${spec.fromLabel}${asked}` : `Move $${spec.amountUsd} USDC margin on Derive: ${spec.fromLabel} to ${spec.toLabel}${asked}`).slice(0, 160),
    why: (opts.why ?? (creating
      ? `You asked for this in the chat. Derive trades each risk universe from its own subaccount, so this creates the ${spec.toLabel} by moving your own USDC into it (Derive charges about $1). Nothing leaves Derive. On approval the agent re-reads your balances and refuses if the source no longer has this much free margin, the subaccount already exists, or the kill switch is on.`
      : `You asked for this in the chat. It moves your own USDC between two of your own Derive subaccounts; nothing leaves Derive. On approval the agent re-reads both balances and refuses if the source no longer has this much free margin, if the kill switch is on, or if it is over your per-move cap.`)).slice(0, 800),
    helps: (creating ? `Lets you trade the ${spec.toLabel.replace(/^new /, '').replace(/ subaccount$/, '')} markets on Derive.` : `Gives ${spec.toLabel} more margin, taken from ${spec.fromLabel}'s free margin.`).slice(0, 500),
    willDo: [creating ? `create the ${spec.toLabel} on Derive by transferring exactly ${spec.amountUsd} USDC from ${spec.fromLabel} (signed with your session key)` : `transfer exactly ${spec.amountUsd} USDC from ${spec.fromLabel} to ${spec.toLabel} on Derive (signed with your session key)`, 'check the transfer was accepted'],
    detail: { candidateId: `chat-move:${spec.fromId}:${spec.toId}`, kind: 'top_up', ruleKey: null, amountBaseUnit: '0', hedgeMarket: null, hedgeKey: null, hedgeDelta: null, optionContracts: null, chatMove: spec },
    idempotencyKey: key,
  };
}

/** The Derive SM manager that opens a subaccount in `universe` (by name, case-insensitive), or an error listing what exists. */
export function managerFor(universes: { id: number; name: string; managers: { managerId: number; marginType: string }[] }[], universe: string): { managerId: number; name: string } {
  const u = universes.find((x) => x.name.toUpperCase() === universe.trim().toUpperCase().replace(/\s*(UNIVERSE|SUBACCOUNT)$/, ''));
  if (!u) throw new Error(`Derive has no "${universe}" risk universe. It has: ${universes.map((x) => x.name).join(', ')}`);
  const m = u.managers.find((x) => x.marginType === 'SM') ?? u.managers[0];
  if (!m) throw new Error(`the ${u.name} universe has no manager to open a subaccount with`);
  return { managerId: m.managerId, name: u.name };
}
