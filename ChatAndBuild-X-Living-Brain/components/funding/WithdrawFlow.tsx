'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import clsx from 'clsx';
import { ArrowDown } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { getJson, useAsterAccount, useDeriveAccount } from '@/lib/hooks/useVenues';
import type { withdrawActionTypedData } from '@/lib/aster-view';

// Venue → the user's own wallet.
//  * Perps (Aster): the USER signs the withdrawal in MetaMask (the agent can never withdraw); the agent only submits
//    it. USDT lands in the same wallet on BNB Chain. UNVERIFIED-live (ported from manager-service).
//  * Options (Derive): signed server-side by the agent key; Derive pays only the account owner, on Ethereum.

type Venue = 'aster' | 'derive';
type AsterWithdrawPrep = { chainId: number; amount: string; fee: string; nonce: string; receiver: string; typedData: ReturnType<typeof withdrawActionTypedData> };
interface Withdrawal { venue: Venue; account: string; amount: string; fee: string | null; status: string; done: boolean; failed: boolean; timestamp: number; txHash: string | null }

const MIN: Record<Venue, number> = { aster: 1, derive: 5 };
const INFO: Record<Venue, string> = {
  aster: 'You sign the withdrawal in MetaMask (no gas) · a fee of about $0.60 is taken from the amount · lands on BNB Chain',
  derive: 'Arrives in about 14 min · options charges a fee of about $1 (capped at $3) from the amount',
};
const AMT = /^\d+(\.\d{1,6})?$/;
const newIdem = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function WithdrawFlow({ onBridge }: { onBridge: () => void }) {
  const { network } = useVenueNetwork();
  const { wallet, signIn } = useSession();
  const [venue, setVenue] = useState<Venue>('aster');
  const [subId, setSubId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [idem, setIdem] = useState(newIdem);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const perps = useAsterAccount();
  const derive = useDeriveAccount();
  const history = useQuery({
    queryKey: ['withdrawals', network, venue, wallet], enabled: !!wallet, refetchInterval: 15_000,
    queryFn: async () => (await getJson<{ withdrawals: Withdrawal[] }>(`/api/trade/withdraw?network=${network}&venue=${venue}`)).withdrawals,
  });

  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const deriveSubs = useMemo(() => (derive.data?.subaccounts ?? []).filter((s) => Number(s.collaterals_value) > 0), [derive.data]);
  const sub = deriveSubs.find((s) => s.subaccount_id === subId) ?? deriveSubs[0];

  // Withdrawable = what the venue will release: the perps free margin; on Derive, USDC held capped by free margin.
  const max = venue === 'aster'
    ? (perps.data?.state === 'ok' ? Math.max(0, perps.data.available ?? 0) : 0)
    : sub ? Math.min(Number(sub.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? 0), Math.max(0, Number(sub.initial_margin))) : 0;
  const unit = venue === 'aster' ? 'USDT' : 'USDC';
  const n = AMT.test(amount) ? Number(amount) : null;
  const problem = n === null ? null : n < MIN[venue] ? `Withdraw at least ${MIN[venue]} ${unit}.` : n > max ? `Only ${max.toFixed(2)} ${unit} can be withdrawn right now.` : null;
  const ready = venue === 'aster' ? perps.data?.state === 'ok' && network === 'mainnet' : derive.data?.state === 'ok';

  function change(v: string) { setAmount(v); setMsg(null); setIdem(newIdem()); }

  async function submit() {
    if (n === null || problem || busy) return;
    setBusy(true); setMsg(null);
    try {
      if (venue === 'aster') {
        const prep = await getJson<AsterWithdrawPrep>('/api/trade/withdraw', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idem }, body: JSON.stringify({ network, venue, step: 'prepare', amount }) });
        // The withdrawal is typed data bound to the destination chain (BNB Chain): MetaMask must be on it.
        if (chainId !== prep.chainId) await switchChainAsync({ chainId: prep.chainId as 56 });
        const td = prep.typedData;
        const signature = await signTypedDataAsync({ domain: td.domain, types: td.types, primaryType: 'Action', message: { ...td.message, nonce: BigInt(td.message.nonce) } });
        await getJson('/api/trade/withdraw', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idem }, body: JSON.stringify({ network, venue, step: 'submit', amount, fee: prep.fee, nonce: prep.nonce, signature }) });
        setMsg({ kind: 'ok', text: `Withdrawal of ${amount} USDT sent (fee ${prep.fee}). It lands in your BNB Chain wallet shortly.` });
      } else {
        const body = { network, venue, amount, subaccountId: sub?.subaccount_id };
        await getJson('/api/trade/withdraw', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idem }, body: JSON.stringify(body) });
        setMsg({ kind: 'ok', text: `Withdrawal of ${amount} USDC sent. It lands in your Ethereum wallet in about 14 min.` });
      }
      setAmount(''); setIdem(newIdem()); void history.refetch();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (!wallet) return <div><h2 className="text-xl font-semibold">Withdraw from a venue</h2><p className="my-3 text-sm text-muted">Sign in first.</p><button className="btn-primary" onClick={() => void signIn()}>Sign in</button></div>;

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-1 text-xl font-semibold">Withdraw from a venue</h2>
      <p className="mb-4 text-sm text-muted">{venue === 'aster'
        ? 'Sends USDT back to your own wallet on BNB Chain. You approve it with one MetaMask signature; the agent key can never withdraw.'
        : `Sends USDC back to your own wallet on ${network === 'testnet' ? 'Sepolia' : 'Ethereum'}. No MetaMask popup: your agent key signs, and it can only pay you.`}</p>

      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-bg p-1 text-sm">
        {(['aster', 'derive'] as const).map((v) => (
          <button key={v} onClick={() => { setVenue(v); change(''); }} className={clsx('rounded-lg py-2', venue === v ? 'bg-panel2 text-white' : 'text-muted hover:text-white')}>{v === 'aster' ? 'Perps' : 'Options'}</button>
        ))}
      </div>

      <div className="rounded-2xl bg-bg p-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
          {venue === 'aster'
            ? <span>From your perps account</span>
            : <select className="rounded-lg bg-panel2 px-2 py-1 text-xs text-white" value={sub?.subaccount_id ?? ''} onChange={(e) => { setSubId(Number(e.target.value)); change(''); }}>
                {deriveSubs.length === 0 && <option value="">No funded subaccount</option>}
                {deriveSubs.map((s) => <option key={s.subaccount_id} value={s.subaccount_id}>#{s.subaccount_id} · {s.universeName ?? (s.isFallback ? 'fallback' : 'subaccount')} · ${Number(s.collaterals_value).toFixed(2)}</option>)}
              </select>}
          <button onClick={() => change(max > 0 ? (Math.floor(max * 1e6) / 1e6).toString() : '')}>Withdrawable: {max.toFixed(2)} {unit}</button>
        </div>
        <div className="flex items-center gap-3"><input className="w-full bg-transparent text-3xl outline-none num" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => change(e.target.value)} /><span className="pill bg-panel2">{unit}</span></div>
      </div>
      <div className="my-2 flex justify-center"><ArrowDown className="text-muted" /></div>
      <div className="rounded-2xl bg-bg p-4 text-sm">
        <div className="text-xs text-muted">To</div><div className="mt-1">{venue === 'aster' ? 'Your wallet on BNB Chain (the signed-in wallet; it is the only allowed receiver)' : `Your wallet on ${network === 'testnet' ? 'Sepolia' : 'Ethereum'} (the account owner, fixed by the venue)`}</div>
        <div className="mt-2 text-xs text-muted">{INFO[venue]}</div>
      </div>

      {!ready && <p className="mt-3 text-xs text-accent">{venue === 'aster'
        ? network !== 'mainnet' ? 'Perps withdrawals are mainnet only.' : perps.data?.state === 'no_deposit' ? 'Nothing to withdraw: deposit to start trading perps.' : 'Register your perps agent key on the Agent keys page first (it submits the withdrawal you sign).'
        : 'Register your options agent key on the Agent keys page first.'}</p>}
      {problem && <p className="mt-3 text-xs text-accent">{problem}</p>}

      <button className="btn-primary mt-4 w-full" disabled={!ready || n === null || !!problem || busy || (venue === 'derive' && !sub)} onClick={() => void submit()}>
        {busy ? (venue === 'aster' ? 'Sign in MetaMask…' : 'Sending…') : venue === 'aster' ? 'Withdraw to my BNB wallet' : 'Withdraw to my Ethereum wallet'}
      </button>
      {msg && <div className={clsx('mt-3 rounded-xl px-3 py-2 text-xs', msg.kind === 'ok' ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{msg.text}</div>}

      {venue === 'derive' && <div className="mt-4 rounded-xl border border-line p-3 text-xs">
        <div className="font-medium">Then bring it to BNB Chain</div>
        <p className="mt-1 text-muted">Once it arrives, bridge it with Relay. You sign that step and pay a little ETH gas.</p>
        <button className="btn-ghost mt-2 w-full py-2 text-xs" disabled={network === 'testnet'} onClick={onBridge}>{network === 'testnet' ? 'Ethereum → BNB is mainnet only' : 'Open Ethereum → BNB'}</button>
      </div>}

      <div className="mt-4">
        <div className="mb-1 text-xs text-muted">Recent {venue === 'aster' ? 'perps' : 'options'} withdrawals</div>
        {history.isLoading ? <p className="text-xs text-muted">Loading…</p>
          : history.error ? <p className="text-xs text-down">{(history.error as Error).message}</p>
          : !history.data?.length ? <p className="text-xs text-muted">{venue === 'aster' ? 'Perps withdrawals are not listed here yet; they show up as incoming USDT in your BNB wallet.' : 'None yet.'}</p>
          : <div className="space-y-1">{history.data.slice(0, 8).map((w, i) => (
              <div key={`${w.timestamp}-${i}`} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-xs">
                <span className="num">{Number(w.amount).toFixed(2)} USDC{w.fee ? <span className="text-muted"> · fee {Number(w.fee).toFixed(2)}</span> : null}</span>
                <span className="text-muted">{new Date(w.timestamp).toLocaleString()}</span>
                <span className={w.failed ? 'text-down' : w.done ? 'text-up' : 'text-accent'} title={w.status === 'claimable' ? 'Ready on Ethereum. The venue normally completes the claim; if it stays here for hours, claim it on app.lighter.xyz.' : undefined}>
                  {w.status === 'claimable' ? 'ready on Ethereum' : w.status}
                </span>
              </div>
            ))}</div>}
      </div>
    </div>
  );
}
