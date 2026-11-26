'use client';
import { useState } from 'react';
import { useAccount, useConfig, useReadContracts } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { erc20Abi, formatUnits, type Address } from 'viem';
import clsx from 'clsx';
import { ArrowDown } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { useBscBalances } from '@/lib/hooks/useBscBalances';
import { getJson, useAsterAccount, useDeriveAccount } from '@/lib/hooks/useVenues';
import { useTxRunner, type Log } from '@/components/funding/useTxRunner';
import { WithdrawFlow } from '@/components/funding/WithdrawFlow';
import { DERIVE, DERIVE_DEFAULT_MANAGER_ID, DERIVE_USDC_ASSET, ETH_USDC } from '@/lib/venues';
import { DERIVE_ACTION_MANAGER_ABI, MOCK_MINT_ABI } from '@/lib/l1';
import { ASTER_DEPOSIT_DECIMALS, ASTER_DEPOSIT_TOKEN, ASTER_MIN_DEPOSIT, ASTER_VAULT_BSC, asterDepositSteps, usdcToUsdtSwapSteps, type AsterAccountView } from '@/lib/aster-view';
import { BSC_USDC, BSC_USDT, PANCAKE_QUOTER_V2, PANCAKE_SMART_ROUTER, QUOTER_V2_ABI, STABLE_HOP_FEE } from '@/lib/bsc';
import { minOut } from '@/lib/swap-path';
import { fmtUnits, safeParseUnits } from '@/lib/format';
import type { BridgeRoute, RelayQuote } from '@/lib/relay';

type Flow = 'bsc_to_perps' | 'bsc_to_eth' | 'eth_to_derive' | 'withdraw' | 'eth_to_bsc';
const FLOWS: { id: Flow; title: string; sub: string; mainnetOnly?: boolean }[] = [
  { id: 'bsc_to_perps', title: 'BNB → Perps', sub: 'Deposit USDT straight from your BNB wallet · no bridge', mainnetOnly: true },
  { id: 'bsc_to_eth', title: 'BNB → Ethereum', sub: 'Relay · for options', mainnetOnly: true },
  { id: 'eth_to_derive', title: 'Ethereum → Options', sub: 'Direct deposit via ActionManager · ~2 min' },
  { id: 'withdraw', title: 'Withdraw from perps / options', sub: 'To your own wallet · perps → BNB, options → Ethereum' },
  { id: 'eth_to_bsc', title: 'Ethereum → BNB', sub: 'Relay · bring venue withdrawals home', mainnetOnly: true },
];

export default function FundingPage() {
  const { network } = useVenueNetwork();
  const [flow, setFlow] = useState<Flow>(network === 'testnet' ? 'eth_to_derive' : 'bsc_to_perps');
  const testnet = network === 'testnet';
  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[320px_1fr]">
      <div className="lg:col-span-2"><WhereMoneyIs /></div>
      <div className="panel p-3 h-fit">
        <div className="px-2 pb-2 text-sm text-muted">Move USDC</div>
        {FLOWS.map((f) => {
          const disabled = testnet && f.mainnetOnly;
          return (
            <button key={f.id} disabled={disabled} onClick={() => setFlow(f.id)}
              className={clsx('w-full rounded-xl px-3 py-3 text-left disabled:opacity-40', flow === f.id ? 'bg-panel2' : 'hover:bg-panel2/50')}>
              <div className="font-medium">{f.title}</div><div className="text-xs text-muted">{disabled ? 'Mainnet only: Relay has no testnet route for this' : f.sub}</div>
            </button>
          );
        })}
        {testnet && <TestnetFaucets />}
      </div>
      <div className="panel p-6">
        {flow === 'bsc_to_eth' || flow === 'eth_to_bsc' ? <RelayFlow route={flow} />
          : flow === 'withdraw' ? <WithdrawFlow onBridge={() => setFlow('eth_to_bsc')} />
          : flow === 'bsc_to_perps' ? <AsterDeposit /> : <DeriveDirect />}
      </div>
    </div>
  );
}

/** Every place USDC can sit, all owned by the same MetaMask address. The app never holds funds. */
function WhereMoneyIs() {
  const { network } = useVenueNetwork();
  const bsc = useBscBalances();
  const dl1 = useL1Usdc(DERIVE[network].usdc, DERIVE[network].chainId);
  const perps = useAsterAccount();
  const derive = useDeriveAccount();
  const l1Name = network === 'testnet' ? 'Sepolia' : 'Ethereum';
  const box = (title: string, sub: string, value: string, note: string, accent?: boolean) => (
    <div className={clsx('min-w-[170px] flex-1 rounded-xl p-3', accent ? 'border border-accent/30 bg-accent/10' : 'bg-bg')}>
      <div className="text-xs text-muted">{sub}</div><div className="font-medium">{title}</div>
      <div className="num mt-1 text-lg">{value}</div><div className="text-[11px] text-muted">{note}</div>
    </div>
  );
  const arrow = <div className="hidden self-center text-muted md:block">→</div>;
  const ds = derive.data?.subaccount;
  const deriveVal = ds ? `$${Number(ds.collaterals_value).toFixed(2)}` : derive.data?.state === 'no_account' ? 'no account' : derive.data?.state === 'needs_agent' ? 'agent needed' : '—';
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">Where your money is</div>
        <div className="text-xs text-muted">All owned by your MetaMask address. Pulse Risk never holds funds; it only moves them between your own accounts.</div>
      </div>
      <div className="flex flex-wrap gap-2 md:flex-nowrap">
        {box('BNB Chain wallet', 'MetaMask · mainnet', `${fmtUnits(bsc.usdc, 18, 2)} USDC · ${fmtUnits(bsc.usdt, 18, 2)} USDT`, 'bStocks collateral, perps deposits, rebalance source')}
        {arrow}
        {box(`${l1Name} wallet`, 'MetaMask · L1', `${fmtUnits(dl1.bal ?? null, dl1.dec, 2)} USDC`,
          network === 'testnet' ? 'options mock USDC' : 'transit: Relay lands here for options')}
        {arrow}
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          {box('Perps account', 'perps margin (USDT)',
            perps.data?.state === 'ok' ? `$${(perps.data.walletBalance ?? 0).toFixed(2)}` : perps.data?.state === 'no_deposit' ? 'no deposit yet' : perps.data?.state === 'needs_agent' ? 'agent needed' : '—',
            'on perps (BNB Chain)', true)}
          {box('Options subaccount', ds ? `#${ds.subaccount_id} · options margin` : 'options margin', deriveVal, 'on options (settles to Ethereum)', true)}
        </div>
      </div>
    </div>
  );
}

function Logs({ logs }: { logs: Log[] }) {
  if (!logs.length) return null;
  return (
    <div className="mt-4 space-y-1 rounded-xl bg-bg p-3 text-xs">
      {logs.map((l, i) => <div key={i} className={l.kind === 'err' ? 'text-down' : l.kind === 'ok' ? 'text-up' : 'text-[#c9ccd6]'}>
        {l.text} {l.href && <a href={l.href} target="_blank" rel="noreferrer" className="underline">view ↗</a>}</div>)}
    </div>
  );
}

function AmountBox({ label, value, onChange, balance, unit }: { label: string; value: string; onChange: (v: string) => void; balance: string; unit: string }) {
  return (
    <div className="rounded-2xl bg-bg p-4">
      <div className="mb-2 flex justify-between text-xs text-muted"><span>{label}</span><button onClick={() => onChange(balance.replace(/,/g, ''))}>Balance: {balance} {unit}</button></div>
      <div className="flex items-center gap-3"><input className="w-full bg-transparent text-3xl outline-none num" inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} /><span className="pill bg-panel2">{unit}</span></div>
    </div>
  );
}

/** Ethereum USDC balance for the connected wallet on the venue network's L1. */
function useL1Usdc(usdc: Address, chainId: number) {
  const { address } = useAccount();
  const r = useReadContracts({ contracts: address ? [{ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: chainId as 1 }, { address: usdc, abi: erc20Abi, functionName: 'decimals', chainId: chainId as 1 }] : [], query: { enabled: !!address, refetchInterval: 5_000 } });
  return { bal: r.data?.[0]?.result as bigint | undefined, dec: (r.data?.[1]?.result as number | undefined) ?? 6, refetch: r.refetch };
}

function RelayFlow({ route }: { route: BridgeRoute }) {
  const { wallet, signIn } = useSession();
  const bsc = useBscBalances();
  const eth = useL1Usdc(ETH_USDC, 1);
  const tx = useTxRunner();
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<RelayQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fromBsc = route !== 'eth_to_bsc';
  const inDec = fromBsc ? 18 : 6;
  const units = safeParseUnits(amount, inDec);
  const bal = fromBsc ? bsc.usdc : eth.bal ?? null;
  const dest = route === 'bsc_to_eth' ? 'Ethereum USDC (your wallet)' : 'BNB Chain USDC (your wallet)';

  async function getQuote() {
    setErr(null); setQuote(null);
    if (!units) return;
    try { setQuote(await getJson<RelayQuote>('/api/relay/quote', { method: 'POST', body: JSON.stringify({ route, amount: units.toString() }) })); }
    catch (e) { setErr((e as Error).message); }
  }
  async function execute() {
    if (!quote) return;
    await tx.run(async () => {
      for (const s of quote.steps) await tx.raw(s.chainId, s.id === 'approve' ? 'Approve USDC (exact amount)' : 'Bridge deposit', s.to, s.data);
      tx.log({ text: 'Waiting for Relay to fill on the destination…', kind: 'info' });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3_000));
        const st = await getJson<{ status: string }>(`/api/relay/status?requestId=${quote.requestId}`).catch(() => ({ status: 'unknown' }));
        if (st.status === 'success') { tx.log({ text: `Delivered to ${dest}`, kind: 'ok' }); bsc.refetch(); void eth.refetch(); return; }
        if (st.status === 'refund') { tx.log({ text: 'Relay refunded the deposit', kind: 'err' }); return; }
      }
      tx.log({ text: 'Still pending after 3 min. Check relay.link for request ' + quote.requestId, kind: 'err' });
    });
    setQuote(null);
  }

  if (!wallet) return <div><h2 className="text-xl font-semibold">Bridge with Relay</h2><p className="my-3 text-sm text-muted">Sign in first so the quote is bound to your wallet.</p><button className="btn-primary" onClick={() => void signIn()}>Sign in</button></div>;
  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-4 text-xl font-semibold">{FLOWS.find((f) => f.id === route)?.title}</h2>
      <AmountBox label={fromBsc ? 'From BNB Chain' : 'From Ethereum'} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} balance={fmtUnits(bal, inDec, 2)} unit="USDC" />
      <div className="my-2 flex justify-center"><ArrowDown className="text-muted" /></div>
      <div className="rounded-2xl bg-bg p-4">
        <div className="text-xs text-muted">To</div><div className="mt-1">{dest}</div>
        {quote && <div className="mt-3 space-y-1 text-sm num">
          <div className="flex justify-between"><span className="text-muted">You receive</span><span>{fmtUnits(BigInt(quote.amountOut), quote.outDecimals, 4)} USDC</span></div>
          <div className="flex justify-between"><span className="text-muted">Guaranteed minimum</span><span>{fmtUnits(BigInt(quote.minOut || '0'), quote.outDecimals, 4)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Relay fee</span><span>${Number(quote.feeUsd).toFixed(3)}</span></div>
          <div className="flex justify-between"><span className="text-muted">ETA</span><span>~{quote.timeEstimateSec}s</span></div>
        </div>}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-ghost flex-1" disabled={!units || tx.busy} onClick={() => void getQuote()}>Get quote</button>
        <button className="btn-primary flex-1" disabled={!quote || tx.busy || (bal !== null && units !== null && units > bal)} onClick={() => void execute()}>{tx.busy ? 'Working…' : 'Bridge'}</button>
      </div>
      {err && <div className="mt-3 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{err}</div>}
      <Logs logs={tx.logs} />
      <p className="mt-4 text-[11px] text-muted">Each Relay step is checked server-side (router, token, amount, depositor) before MetaMask sees it. The approval is for the exact amount.</p>
    </div>
  );
}

/**
 * BNB Chain → perps: the user's own wallet deposits USDT into the perps vault (approve if needed → deposit, broker 1).
 * Paying with USDC swaps it to USDT on PancakeSwap first. Then the perps balance is polled until it rises.
 */
function AsterDeposit() {
  const { network } = useVenueNetwork();
  const { address } = useAccount();
  const { wallet, signIn } = useSession();
  const config = useConfig();
  const bsc = useBscBalances();
  const perps = useAsterAccount();
  const tx = useTxRunner();
  const [pay, setPay] = useState<'USDT' | 'USDC'>('USDT');
  const [amount, setAmount] = useState('');
  const units = safeParseUnits(amount, ASTER_DEPOSIT_DECIMALS);
  const bal = pay === 'USDT' ? bsc.usdt : bsc.usdc;
  const tooSmall = units !== null && units < ASTER_MIN_DEPOSIT;
  const tooBig = units !== null && bal !== null && units > bal;

  const allowance = (token: Address, spender: Address) =>
    readContract(config, { address: token, abi: erc20Abi, functionName: 'allowance', args: [address!, spender], chainId: 56 });
  const usdtBalance = () => readContract(config, { address: BSC_USDT, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: 56 });
  const perpsBalance = async () => (await getJson<AsterAccountView>(`/api/trade/aster-account?network=${network}`).catch(() => null));

  async function go() {
    if (!units || !address) return;
    await tx.run(async () => {
      let depositUnits = units;
      if (pay === 'USDC') {
        // Quote the 0.01% USDC/USDT pool and accept at most 0.3% slippage.
        const [quoted] = await readContract(config, { address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: BSC_USDC, tokenOut: BSC_USDT, amountIn: units, fee: STABLE_HOP_FEE, sqrtPriceLimitX96: 0n }], chainId: 56 });
        const before = await usdtBalance();
        const steps = usdcToUsdtSwapSteps(address, units, minOut(quoted, 30), await allowance(BSC_USDC, PANCAKE_SMART_ROUTER), BigInt(Math.floor(Date.now() / 1000) + 600));
        for (const st of steps) await tx.raw(56, st.label, st.to, st.data);
        depositUnits = (await usdtBalance()) - before;
        if (depositUnits <= 0n) throw new Error('The swap returned no USDT; nothing was deposited');
        tx.log({ text: `Swapped to ${formatUnits(depositUnits, ASTER_DEPOSIT_DECIMALS)} USDT`, kind: 'ok' });
      }
      const start = await perpsBalance();
      for (const st of asterDepositSteps(depositUnits, await allowance(ASTER_DEPOSIT_TOKEN, ASTER_VAULT_BSC))) await tx.raw(56, st.label, st.to, st.data);
      if (!start || start.state === 'needs_agent') {
        tx.log({ text: 'Deposited. Register the perps agent (Agent keys) to see it as margin.', kind: 'ok' });
        return;
      }
      const base = start.walletBalance ?? 0;
      const human = formatUnits(depositUnits, ASTER_DEPOSIT_DECIMALS);
      tx.log({ text: 'Waiting for perps to credit the deposit…', kind: 'info' });
      const credited = async (secs: number) => {
        for (let t = 0; t < secs; t += 6) {
          await new Promise((r) => setTimeout(r, 6_000));
          const v = await perpsBalance();
          if (v?.state === 'ok' && (v.walletBalance ?? 0) > base + 0.01) return true;
        }
        return false;
      };
      if (await credited(90)) { tx.log({ text: `${human} USDT is now perps margin`, kind: 'ok' }); return; }
      // UNVERIFIED on BNB Chain: on Arbitrum a vault deposit was credited to the venue's SPOT balance and needed a
      // spot → futures transfer. Do that once, signed by the agent (it only moves money between the user's own balances).
      tx.log({ text: 'Not in margin after 90 s; moving it from the perps spot balance to margin…', kind: 'info' });
      try {
        await getJson('/api/trade/aster-transfer', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `dep-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify({ network, amount: human }) });
      } catch (e) {
        tx.log({ text: `Transfer not needed or not possible yet: ${(e as Error).message}`, kind: 'info' });
      }
      tx.log(await credited(60)
        ? { text: `${human} USDT is now perps margin`, kind: 'ok' }
        : { text: 'The deposit is confirmed on BNB Chain but perps has not credited it yet. It usually appears within a few minutes; check Portfolio.', kind: 'info' });
    });
    void perps.refetch(); bsc.refetch();
  }

  if (network === 'testnet') return <div><h2 className="text-xl font-semibold">BNB → Perps</h2><p className="mt-3 text-sm text-muted">Perps deposits are mainnet only. Switch the sidebar to Mainnet.</p></div>;
  if (!wallet) return <div><h2 className="text-xl font-semibold">BNB → Perps</h2><p className="my-3 text-sm text-muted">Sign in first so the app can read your perps balance.</p><button className="btn-primary" onClick={() => void signIn()}>Sign in</button></div>;
  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-1 text-xl font-semibold">BNB → Perps</h2>
      <p className="mb-4 text-sm text-muted">Perps margin is USDT on BNB Chain. Your wallet deposits it directly: no bridge, gas in BNB.</p>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-bg p-1 text-sm">
        {(['USDT', 'USDC'] as const).map((t) => (
          <button key={t} onClick={() => { setPay(t); setAmount(''); }} className={clsx('rounded-lg py-2', pay === t ? 'bg-panel2 text-white' : 'text-muted hover:text-white')}>Pay with {t}</button>
        ))}
      </div>
      <AmountBox label={`${pay} on BNB Chain`} value={amount} onChange={setAmount} balance={fmtUnits(bal, 18, 2)} unit={pay} />
      <div className="my-2 flex justify-center"><ArrowDown className="text-muted" /></div>
      <div className="rounded-2xl bg-bg p-4 text-sm">
        <div className="text-xs text-muted">To</div><div className="mt-1">Your perps account (margin, USDT)</div>
        <div className="mt-2 text-xs text-muted">Now: {perps.data?.state === 'ok' ? `${(perps.data.walletBalance ?? 0).toFixed(2)} USDT` : perps.data?.state === 'no_deposit' ? 'no deposit yet' : perps.data?.state === 'needs_agent' ? 'register the perps agent to read it' : '—'}</div>
        {pay === 'USDC' && <div className="mt-2 text-xs text-muted">USDC is swapped to USDT on PancakeSwap first (0.01% pool, at most 0.3% slippage), then the USDT you receive is deposited.</div>}
      </div>
      {tooSmall && <p className="mt-2 text-xs text-accent">Deposit at least 5 USDT (the perps minimum order is $5).</p>}
      <button className="btn-primary mt-4 w-full" disabled={!units || tooSmall || tooBig || tx.busy} onClick={() => void go()}>{tx.busy ? 'Working…' : pay === 'USDC' ? 'Swap & deposit' : 'Approve & deposit'}</button>
      <Logs logs={tx.logs} />
      <p className="mt-4 text-[11px] text-muted">Approvals are for the exact amount. The deposit goes from your own wallet to the perps vault on BNB Chain; only you can withdraw it.</p>
    </div>
  );
}

function DeriveDirect() {
  const { network } = useVenueNetwork();
  const { address } = useAccount();
  const cfg = DERIVE[network];
  const l1 = useL1Usdc(cfg.usdc, cfg.chainId);
  const acct = useDeriveAccount();
  const tx = useTxRunner();
  const [amount, setAmount] = useState('');
  const units = safeParseUnits(amount, l1.dec);
  const min = 7n * 10n ** BigInt(l1.dec); // live min_deposit_usd is 5; below it the deposit is donated, so keep a margin
  const existing = acct.data?.state === 'ok' || acct.data?.state === 'needs_agent';
  async function go() {
    if (!units || !address) return;
    await tx.run(async () => {
      await tx.call(cfg.chainId, 'Approve USDC (exact amount)', cfg.usdc, erc20Abi, 'approve', [cfg.actionManager, units]);
      await tx.call(cfg.chainId, 'Deposit to options', cfg.actionManager, DERIVE_ACTION_MANAGER_ABI, 'depositToNewSubaccount', [DERIVE_USDC_ASSET, units, DERIVE_DEFAULT_MANAGER_ID, address]);
      tx.log({ text: 'Options credits L1 deposits in ~1.5–2 min.', kind: 'ok' });
    });
  }
  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-1 text-xl font-semibold">Ethereum → Options</h2>
      <p className="mb-4 text-sm text-muted">{network === 'testnet' ? 'Sepolia (options mock USDC)' : 'Ethereum mainnet'} · Standard margin, PRIME universe (BTC/ETH options + perps)</p>
      <AmountBox label="USDC" value={amount} onChange={setAmount} balance={fmtUnits(l1.bal ?? null, l1.dec, 2)} unit="USDC" />
      {units !== null && units < min && <p className="mt-2 text-xs text-accent">Deposit at least 7 USDC. Below the options live minimum ($5), the deposit is lost.</p>}
      {existing && <p className="mt-2 text-xs text-muted">Each direct deposit opens a new subaccount. The agent consolidates into your trading subaccount with transfer_spot.</p>}
      <button className="btn-primary mt-4 w-full" disabled={!units || units < min || tx.busy || (l1.bal !== undefined && units > l1.bal)} onClick={() => void go()}>{tx.busy ? 'Working…' : 'Approve & deposit'}</button>
      <Logs logs={tx.logs} />
    </div>
  );
}

function TestnetFaucets() {
  const { address } = useAccount();
  const tx = useTxRunner();
  return (
    <div className="mt-3 border-t border-line px-2 pt-3 text-xs">
      <div className="mb-2 text-muted">Testnet faucet (needs Sepolia ETH for gas). Perps has no testnet deposits.</div>
      <button className="btn-ghost w-full py-2 text-xs" disabled={!address || tx.busy} onClick={() => void tx.run(() => tx.call(11155111, 'Mint 1,000 options mock USDC', DERIVE.testnet.usdc, MOCK_MINT_ABI, 'mint', [address, 1_000_000_000n]))}>Mint options mock USDC</button>
      <Logs logs={tx.logs} />
    </div>
  );
}
