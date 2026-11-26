'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useReadContracts } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { erc20Abi, type Address } from 'viem';
import clsx from 'clsx';
import { CheckCircle2, ChevronDown, AlertTriangle, Wallet } from 'lucide-react';
import { BSC_USDC, BSC_USDT } from '@/lib/bsc';
import { fmtUnits, safeParseUnits, shortAddr } from '@/lib/format';
import { getJson } from '@/lib/hooks/useVenues';
import { useBscBalances } from '@/lib/hooks/useBscBalances';
import { useTxRunner } from '@/components/funding/useTxRunner';
import type { AgentConfig } from '@/lib/agent-config';
import { baseUnitsToText, usdToBaseUnits } from '@/lib/risk-rules';

// One question, one button: "how much may the agent use for top-ups?" It always takes USDC first, then USDT, and
// (only if the box is ticked) sells your bStocks last. Allow = MetaMask approvals for exactly that; Stop = set them to 0.

type Funding = Pick<AgentConfig['rebalance'], 'sources' | 'sellOrder' | 'keepBscReserveBaseUnit'> & { haircut: number };

const E18 = 10n ** 18n;
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: bigint | null | undefined) => (v ? Number(fmtUnits(v, 18, 6).replace(/,/g, '')) : 0);
const MIN_TOPUP = 6; // smallest venue top-up (perps $6, options $7)

export function FundingPanel({ value, prices, haircutFor, onSave }: { value: Funding; prices: Record<string, number | null>; /** Per-token haircut from price integrity; omitted = the flat haircut for every token. */ haircutFor?: (symbol: string) => number; onSave: (next: Funding) => Promise<string | null> }) {
  const { address } = useAccount();
  const info = useQuery({ queryKey: ['agent-info'], queryFn: () => getJson<{ bscAddress: Address | null }>('/api/agent/info') });
  const agent = info.data?.bscAddress ?? null;
  const bal = useBscBalances();
  const tx = useTxRunner();
  const [amount, setAmount] = useState('');
  const [sellStocks, setSellStocks] = useState(value.sources.includes('sell_bstocks'));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setSellStocks(value.sources.includes('sell_bstocks')), [value.sources]);

  const held = bal.holdings.filter((h) => h.ui > 0n);
  const tokens: { id: string; address: Address }[] = [{ id: 'USDC', address: BSC_USDC }, { id: 'USDT', address: BSC_USDT }, ...held.map((h) => ({ id: h.symbol, address: h.address }))];
  const reads = useReadContracts({
    contracts: address && agent ? tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'allowance' as const, args: [address, agent] as const, chainId: bsc.id })) : [],
    query: { enabled: !!address && !!agent, refetchInterval: 6_000 },
  });
  const allowed = (id: string) => (reads.data?.[tokens.findIndex((t) => t.id === id)]?.result as bigint | undefined) ?? 0n;

  // What the agent can really use now: allowed AND held, minus the reserve; bStocks only if selling is on, after the safety margin.
  const reserve = Number(BigInt(value.keepBscReserveBaseUnit)) / 1e6;
  const min = (a: bigint, b: bigint | null) => (b === null ? 0n : a < b ? a : b);
  // Same rule as the agent (lib/plan.ts planFunding): the reserve comes off the BALANCE (USDC first, then USDT), and the
  // allowance caps what is left.
  const usdcBalN = num(bal.usdc); const usdtBalN = num(bal.usdt);
  const usdcFree = Math.max(0, usdcBalN - reserve); const usdtFree = Math.max(0, usdtBalN - Math.max(0, reserve - usdcBalN));
  const stables = Math.min(num(allowed('USDC')), usdcFree) + Math.min(num(allowed('USDT')), usdtFree);
  const stocks = value.sources.includes('sell_bstocks') ? held.filter((h) => value.sellOrder.includes(h.symbol)).reduce((s, h) => {
    const p = prices[h.symbol]; if (!p) return s;
    return s + num((min(allowed(h.symbol), h.raw) * h.uiMultiplier) / E18) * p * (1 - (haircutFor ? haircutFor(h.symbol) : value.haircut));
  }, 0) : 0;
  const total = stables + stocks;
  const anyAllowed = tokens.some((t) => allowed(t.id) > 0n);

  const units = safeParseUnits(amount, 18);
  // Each approval costs a little BNB gas (≈0.0000025 BNB at 0.05 gwei). With none, MetaMask fails before anything is sent.
  const noGas = bal.bnb !== null && bal.bnb < 10n ** 13n; // < 0.00001 BNB
  const usdcBal = usdcBalN;

  async function allow() {
    if (!agent || !units) return;
    setNote(null);
    let ok = false;
    await tx.run(async () => {
      // USDC for the amount; USDT too if you hold any. Then, if ticked, each bStock you hold.
      await tx.call(bsc.id, `Allow $${amount} USDC`, BSC_USDC, erc20Abi, 'approve', [agent, units]);
      if ((bal.usdt ?? 0n) > 0n) await tx.call(bsc.id, `Allow $${amount} USDT`, BSC_USDT, erc20Abi, 'approve', [agent, units]);
      if (sellStocks) for (const h of held) await tx.call(bsc.id, `Allow selling your ${h.symbol}`, h.address, erc20Abi, 'approve', [agent, h.raw]);
      await reads.refetch();
      ok = true;
    });
    // tx.run swallows the error (and logs it): only save and say "done" if every approval went through.
    if (!ok) { setNote({ ok: false, text: 'Not allowed: the MetaMask approval did not go through. Nothing was changed.' }); return; }
    const e = await onSave({ ...value, sources: ['bsc_usdc', 'bsc_usdt', ...(sellStocks ? ['sell_bstocks' as const] : [])], sellOrder: sellStocks ? held.map((h) => h.symbol) : value.sellOrder });
    setNote(e ? { ok: false, text: e } : { ok: true, text: 'Done. The agent can now use this for top-ups.' });
    setAmount('');
  }

  async function stop() {
    if (!agent) return;
    setNote(null);
    let ok = false;
    await tx.run(async () => {
      for (const t of tokens) if (allowed(t.id) > 0n) await tx.call(bsc.id, `Stop: ${t.id}`, t.address, erc20Abi, 'approve', [agent, 0n]);
      await reads.refetch();
      ok = true;
    });
    // Never claim "stopped" unless every revoke went through: the user would wrongly think the agent can't take funds.
    setNote(ok ? { ok: true, text: 'Stopped. The agent can no longer take anything from your BNB wallet.' }
      : { ok: false, text: 'Not stopped: a MetaMask step did not go through. The agent may still use what is shown above. Try Stop again.' });
  }

  if (!agent) return <section className="panel p-5 text-sm text-muted">The agent&apos;s BNB address isn&apos;t configured (<code>AGENT_BSC_ADDRESS</code>), so it can&apos;t be given anything to use yet.</section>;

  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2 font-semibold"><Wallet size={17} className="text-accent" />Agent budget for top-ups</div>
      <p className="mt-0.5 text-[12px] text-muted">When a perps or options account needs margin, the agent sends it from your BNB wallet, only to <b>your own</b> accounts.</p>

      <div className={clsx('mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm', total >= MIN_TOPUP ? 'bg-up/10 text-up' : 'bg-accent/10 text-accent')}>
        <span className="flex items-center gap-2">
          {total >= MIN_TOPUP ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {!address ? 'Connect MetaMask to set a budget.'
            : total >= MIN_TOPUP ? <>The agent can use up to <b className="num">{usd(total)}</b>{stocks > 0 ? <span className="text-[12px]"> (incl. {usd(stocks)} by selling bStocks)</span> : null}.</>
            : usdcFree + usdtFree < MIN_TOPUP && !stocks
              ? <>Not enough USDC on BNB: you keep {usd(reserve)} aside, leaving {usd(usdcFree + usdtFree)}. A top-up needs {usd(MIN_TOPUP)}. Lower the reserve under Advanced or add USDC.</>
              : <>The agent can use <b className="num">{usd(total)}</b>. Allow at least <b>{usd(MIN_TOPUP)}</b> below so it can make a top-up.</>}
        </span>
        {anyAllowed && <button type="button" className="rounded-lg border border-current px-3 py-1 text-xs disabled:opacity-40" disabled={tx.busy} onClick={() => void stop()}>Stop</button>}
      </div>

      <div className="mt-4 text-sm font-medium">How much can the agent use?</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg bg-bg px-3 ring-1 ring-inset ring-line"><span className="text-muted">$</span>
          <input className="w-28 bg-transparent px-1 py-2.5 text-base outline-none num" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        {[6, 10, 25].map((n) => <button key={n} type="button" className="rounded-lg bg-bg px-3 py-2.5 text-sm ring-1 ring-inset ring-line hover:text-white" onClick={() => setAmount(String(n))}>${n}</button>)}
        {usdcBal > 0 && <button type="button" className="rounded-lg bg-bg px-3 py-2.5 text-sm ring-1 ring-inset ring-line hover:text-white" onClick={() => setAmount(String(Math.floor(usdcBal * 100) / 100))}>All</button>}
      </div>

      {held.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={sellStocks} onChange={(e) => setSellStocks(e.target.checked)} />
          <span>If USDC runs out, it may <b>sell my bStocks</b> ({held.map((h) => h.symbol).join(', ')})<span className="block text-[12px] text-muted">Last resort only, on PancakeSwap at a safe price.</span></span>
        </label>
      )}

      {noGas && <p className="mt-3 rounded-lg bg-down/10 px-3 py-2 text-xs text-down">You have no BNB for gas. Send about 0.002 BNB (~$1) to your wallet on BNB Smart Chain, then click Allow. Each approval costs a fraction of a cent.</p>}
      <button type="button" className="btn-primary mt-4 w-full py-3 text-base sm:w-auto sm:px-8" disabled={!address || !units || tx.busy || noGas} onClick={() => void allow()}>
        {tx.busy ? 'Confirm in MetaMask…' : units ? `Allow $${amount}` : 'Allow'}
      </button>
      <p className="mt-2 text-[11px] text-muted">MetaMask asks you to approve {sellStocks && held.length ? `${1 + ((bal.usdt ?? 0n) > 0n ? 1 : 0) + held.length} small steps` : (bal.usdt ?? 0n) > 0n ? '2 small steps' : 'once'}. Only the agent ({shortAddr(agent)}) can use it, and only up to this amount.</p>

      {tx.logs.length > 0 && (tx.busy || tx.logs[tx.logs.length - 1].kind === 'err') && (
        <p className={clsx('mt-2 text-xs', tx.logs[tx.logs.length - 1].kind === 'err' ? 'text-down' : 'text-muted')}>{tx.logs[tx.logs.length - 1].text}</p>)}
      {note && <p className={clsx('mt-2 text-xs', note.ok ? 'text-up' : 'text-down')}>{note.text}</p>}

      <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="mt-5 flex items-center gap-1 text-xs text-muted hover:text-white">
        <ChevronDown size={14} className={clsx('transition', showAdvanced && 'rotate-180')} />Advanced
      </button>
      {showAdvanced && <Advanced value={value} onSave={(n) => void onSave(n).then((e) => setNote(e ? { ok: false, text: e } : { ok: true, text: 'Saved' }))} />}
    </section>
  );
}

function Advanced({ value, onSave }: { value: Funding; onSave: (next: Funding) => void }) {
  const [reserve, setReserve] = useState(baseUnitsToText(value.keepBscReserveBaseUnit) || '0');
  const [haircut, setHaircut] = useState(String(Math.round(value.haircut * 100)));
  useEffect(() => { setReserve(baseUnitsToText(value.keepBscReserveBaseUnit) || '0'); setHaircut(String(Math.round(value.haircut * 100))); }, [value.keepBscReserveBaseUnit, value.haircut]);
  const commitReserve = () => { const v = reserve.trim() === '' || Number(reserve) === 0 ? '0' : usdToBaseUnits(reserve); if (v !== null && v !== value.keepBscReserveBaseUnit) onSave({ ...value, keepBscReserveBaseUnit: v }); };
  const commitHaircut = () => { const n = Number(haircut); if (Number.isFinite(n) && n >= 0 && n <= 90 && n / 100 !== value.haircut) onSave({ ...value, haircut: n / 100 }); };
  return (
    <div className="mt-3 grid gap-3 rounded-xl bg-bg p-4 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium">Always keep on BNB</span>
        <span className="mt-0.5 block text-[12px] text-muted">USDC/USDT the agent never touches.</span>
        <span className="mt-2 flex items-center rounded-lg bg-panel2 px-2"><span className="text-muted">$</span>
          <input className="w-full bg-transparent px-1 py-2 text-sm outline-none num" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} onBlur={commitReserve} onKeyDown={(e) => { if (e.key === 'Enter') commitReserve(); }} /></span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">bStock safety margin</span>
        <span className="mt-0.5 block text-[12px] text-muted">30% = a $100 stock counts as $70 when selling.</span>
        <span className="mt-2 flex items-center rounded-lg bg-panel2 px-2">
          <input className="w-full bg-transparent px-1 py-2 text-sm outline-none num" inputMode="decimal" value={haircut} onChange={(e) => setHaircut(e.target.value)} onBlur={commitHaircut} onKeyDown={(e) => { if (e.key === 'Enter') commitHaircut(); }} /><span className="text-muted">%</span></span>
      </label>
    </div>
  );
}
