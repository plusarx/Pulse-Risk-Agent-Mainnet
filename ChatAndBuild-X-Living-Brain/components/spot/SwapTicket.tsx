'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { encodeFunctionData, type Address } from 'viem';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { ERC20_ABI, PANCAKE_SMART_ROUTER, SMART_ROUTER_ABI } from '@/lib/bsc';
import { fmtNum, fmtUnits, safeParseUnits, toFloat } from '@/lib/format';
import { buildPath, minOut, PAY_TOKENS, type PayToken } from '@/lib/swap-path';
import type { BStockToken } from '@/lib/bstocks';
import { MIN_LIQUIDITY_USD } from '@/lib/bstocks';

interface Quote { best: { fee: number; amountOut: string } | null; tiers: { fee: number; amountOut: string | null }[] }
const ONE = 10n ** 18n;

export function SwapTicket({ token, refPrice, balances, onFilled }: {
  token: BStockToken; refPrice: number | null;
  balances: { usdc: bigint | null; usdt: bigint | null; stockRaw: bigint | null; uiMultiplier: bigint | null };
  onFilled: () => void;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: bsc.id });
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [pay, setPay] = useState<PayToken>('USDC');
  const [amount, setAmount] = useState('');
  const [slipBps, setSlipBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'info' | 'ok' | 'err'; msg: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const mult = balances.uiMultiplier ?? ONE;
  const payBal = pay === 'USDC' ? balances.usdc : balances.usdt;
  const stockUi = balances.stockRaw !== null ? (balances.stockRaw * mult) / ONE : null;

  // Amount typed by the user: buy → pay-token units; sell → bStock UI units (converted to RAW for the tx).
  const amountIn: bigint | null = useMemo(() => {
    const parsed = safeParseUnits(amount, 18);
    if (!parsed || parsed === 0n) return null;
    if (side === 'buy') return parsed;
    return mult === 0n ? null : (parsed * ONE) / mult; // ui → raw
  }, [amount, side, mult]);

  const maxIn = side === 'buy' ? payBal : balances.stockRaw;
  const insufficient = amountIn !== null && maxIn !== null && amountIn > maxIn;
  const lowLiquidity = token.observedLiquidityUsd < MIN_LIQUIDITY_USD;

  useEffect(() => {
    setQuote(null);
    if (!amountIn) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await fetch(`/api/bstocks/quote?symbol=${token.symbol}&side=${side}&pay=${pay}&amountIn=${amountIn}`, { signal: ctl.signal });
        if (r.ok) setQuote((await r.json()) as Quote);
      } catch { /* aborted or network — quote stays empty and the button stays disabled */ }
      finally { setQuoting(false); }
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [amountIn, side, pay, token.symbol]);

  const out = quote?.best ? BigInt(quote.best.amountOut) : null;
  const outDisplay = out === null ? null : side === 'buy' ? (out * mult) / ONE : out; // buy → bStock UI units
  const execPrice = amountIn && out ? (side === 'buy' ? toFloat(amountIn, 18) / toFloat((out * mult) / ONE, 18) : toFloat(out, 18) / toFloat((amountIn * mult) / ONE, 18)) : null;
  const deviation = execPrice && refPrice ? ((execPrice - refPrice) / refPrice) * 100 * (side === 'buy' ? 1 : -1) : null;

  const setPct = (p: number) => {
    if (side === 'buy' && payBal !== null) setAmount(fmtPlain((payBal * BigInt(p)) / 100n));
    if (side === 'sell' && stockUi !== null) setAmount(fmtPlain((stockUi * BigInt(p)) / 100n));
  };

  async function execute() {
    if (!address || !amountIn || !quote?.best || !client) return;
    setBusy(true); setStatus(null);
    try {
      if (chainId !== bsc.id) await switchChainAsync({ chainId: bsc.id });
      const tokenIn: Address = side === 'buy' ? PAY_TOKENS[pay] : token.address;
      const allowance = await client.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: 'allowance', args: [address, PANCAKE_SMART_ROUTER] });
      if (allowance < amountIn) {
        setStatus({ kind: 'info', msg: 'Approve the exact amount in MetaMask…' });
        const h = await writeContractAsync({ address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [PANCAKE_SMART_ROUTER, amountIn], chainId: bsc.id });
        await client.waitForTransactionReceipt({ hash: h });
      }
      // Re-quote right before signing so minOut reflects the current pool.
      const fresh = (await (await fetch(`/api/bstocks/quote?symbol=${token.symbol}&side=${side}&pay=${pay}&amountIn=${amountIn}`)).json()) as Quote;
      if (!fresh.best) throw new Error('No liquidity at any fee tier');
      const path = buildPath(side, pay, token.address, fresh.best.fee);
      const amountOutMinimum = minOut(BigInt(fresh.best.amountOut), slipBps);
      const swap = encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'exactInput', args: [{ path, recipient: address, amountIn, amountOutMinimum }] });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      setStatus({ kind: 'info', msg: 'Confirm the swap in MetaMask…' });
      const hash = await writeContractAsync({ address: PANCAKE_SMART_ROUTER, abi: SMART_ROUTER_ABI, functionName: 'multicall', args: [deadline, [swap]], chainId: bsc.id });
      setStatus({ kind: 'info', msg: 'Swap submitted, waiting for confirmation…', hash });
      const rcpt = await client.waitForTransactionReceipt({ hash });
      if (rcpt.status !== 'success') throw new Error('Swap reverted (price moved beyond slippage?)');
      setStatus({ kind: 'ok', msg: `${side === 'buy' ? 'Bought' : 'Sold'} ${token.symbol}`, hash });
      // Record it for Order history. The server reads the swap back from the chain; a failure here never affects the trade.
      void fetch('/api/trade/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: hash }) })
        .then(() => qc.invalidateQueries({ queryKey: ['order-history'] })).catch(() => undefined);
      setAmount('');
      onFilled();
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message.split('\n')[0] : 'Swap failed' });
    } finally { setBusy(false); }
  }

  const disabled = !isConnected || !amountIn || !quote?.best || insufficient || busy || quoting || lowLiquidity;
  const label = !isConnected ? 'Connect MetaMask to trade' : lowLiquidity ? 'Liquidity too thin to trade' : insufficient ? 'Insufficient balance' : busy ? 'Working…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${token.symbol}`;

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 rounded-2xl bg-bg p-1">
        <button className={clsx('rounded-xl py-3 font-medium', side === 'buy' ? 'bg-up/15 text-up' : 'text-[#c9ccd6]')} onClick={() => { setSide('buy'); setAmount(''); }}>Buy</button>
        <button className={clsx('rounded-xl py-3 font-medium', side === 'sell' ? 'bg-down/15 text-down' : 'text-[#c9ccd6]')} onClick={() => { setSide('sell'); setAmount(''); }}>Sell</button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="pill pill-on">Market</span>
        <span className="pill text-muted cursor-not-allowed" title="bStocks fill against PancakeSwap V3 pools — market (swap) only. Limit/conditional orders are run by the agent.">Limit</span>
        <span className="ml-auto label">via PancakeSwap V3</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="label">Balance</span>
        <span className="text-sm num">{side === 'buy' ? `${fmtUnits(payBal, 18, 2)} ${pay}` : `${fmtUnits(stockUi, 18, 4)} ${token.symbol}`}</span>
      </div>
      {side === 'buy' && (
        <div className="flex gap-2">{(['USDC', 'USDT'] as const).map((p) => (
          <button key={p} onClick={() => setPay(p)} className={clsx('pill flex-1', pay === p ? 'bg-panel2 text-white' : 'text-muted border border-line')}>Pay {p}</button>
        ))}</div>
      )}
      <div>
        <div className="label mb-1.5">{side === 'buy' ? `Amount (${pay})` : `Quantity (${token.symbol})`}</div>
        <input className="input" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
      </div>
      <div className="flex justify-between gap-2">{[25, 50, 75, 100].map((p) => (
        <button key={p} onClick={() => setPct(p)} className="flex-1 rounded-lg bg-panel2 py-1.5 text-xs text-[#c9ccd6] hover:text-white">{p}%</button>
      ))}</div>
      <div className="rounded-xl bg-bg p-3 text-sm space-y-1.5">
        <Row k="You receive" v={outDisplay === null ? (quoting ? 'Quoting…' : '—') : `${fmtUnits(outDisplay, 18, 4)} ${side === 'buy' ? token.symbol : pay}`} />
        <Row k="Exec price" v={execPrice ? `$${fmtNum(execPrice, 2)}` : '—'} />
        <Row k="vs reference" v={deviation === null ? '—' : `${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%`} warn={deviation !== null && deviation > 1} />
        <Row k="Pool fee tier" v={quote?.best ? `${quote.best.fee / 10000}%${pay === 'USDC' && side === 'buy' ? ' (+0.01% USDC→USDT)' : ''}` : '—'} />
        <div className="flex items-center justify-between">
          <span className="text-muted">Max slippage</span>
          <div className="flex gap-1">{[10, 50, 100].map((b) => (
            <button key={b} onClick={() => setSlipBps(b)} className={clsx('rounded-md px-2 py-0.5 text-xs', slipBps === b ? 'bg-white text-black' : 'bg-panel2 text-muted')}>{b / 100}%</button>
          ))}</div>
        </div>
      </div>
      <button className={side === 'buy' ? 'btn bg-up text-black hover:bg-up/90' : 'btn bg-down text-black hover:bg-down/90'} disabled={disabled} onClick={() => void execute()}>{label}</button>
      {status && (
        <div className={clsx('rounded-xl px-3 py-2 text-xs', status.kind === 'err' ? 'bg-down/10 text-down' : status.kind === 'ok' ? 'bg-up/10 text-up' : 'bg-panel2 text-[#c9ccd6]')}>
          {status.msg} {status.hash && <a className="underline" target="_blank" rel="noreferrer" href={`https://bscscan.com/tx/${status.hash}`}>BscScan ↗</a>}
        </div>
      )}
      <p className="text-[11px] leading-snug text-muted">Swaps run from your MetaMask on BNB Chain (gas in BNB). Approvals are for the exact amount only. Every fee tier is quoted, and the best one is used.</p>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className={clsx('num', warn && 'text-accent')}>{v}</span></div>;
}

/** 18-dec bigint → plain decimal string for an input box (no grouping, trimmed). */
function fmtPlain(v: bigint): string {
  const s = v.toString().padStart(19, '0');
  const i = s.slice(0, -18); const f = s.slice(-18, -12).replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}
