'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import clsx from 'clsx';
import { CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { getJson, useAgentKeys, type AgentKeyRow } from '@/lib/hooks/useVenues';
import { shortAddr } from '@/lib/format';

type TypedData = { domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }; types: { Action: { name: string; type: string }[] }; primaryType: 'Action'; message: Record<string, string> };

/** Our JSON keeps uint256 as strings; wagmi wants bigints for those fields. */
function toSignable(td: TypedData) {
  const m = td.message;
  return { ...td, message: { ...m, subaccountId: BigInt(m.subaccountId), nonce: BigInt(m.nonce), expiry: BigInt(m.expiry) } };
}

type AsterTypedData = { domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }; types: { Message: { name: string; type: string }[] }; primaryType: 'Message'; message: { msg: string } };

const VENUES = {
  aster: {
    name: 'Perps', kind: 'Perps', color: 'text-[#a593ff]',
    can: ['Place and cancel perp orders', 'Read your perps balance, positions and orders', 'Move your own perps balance from spot to futures margin'],
    cannot: ['Withdraw: every withdrawal needs your MetaMask signature and pays only your own wallet', 'Trade spot or register other keys'],
    sign: '1 MetaMask signature on BNB Chain (typed data, no gas)',
  },
  lighter: {
    name: 'Perps', kind: 'Perps', color: 'text-[#a593ff]',
    can: ['Place, modify and cancel perp orders', 'Move USDC between your own perps accounts', 'Secure-withdraw to your own Ethereum address'],
    cannot: ['Send funds to anyone else (needs your MetaMask signature)', 'Register other keys'],
    sign: '1 MetaMask signature (personal_sign, no gas)',
  },
  derive: {
    name: 'Options', kind: 'Options', color: 'text-[#5fd0ff]',
    can: ['Trade options and perps (trade:all)', 'Transfer between your own subaccounts', 'Withdraw to your own wallet (whitelisted at setup)'],
    cannot: ['admin, set_session_key, transfer:all or transfers to other owners (never requested)'],
    sign: '3 MetaMask signatures on Ethereum/Sepolia (2 typed-data + 1 login), no gas',
  },
} as const;

export default function AgentsPage() {
  const { isConnected } = useAccount();
  const { wallet, signIn, signingIn } = useSession();
  const { network } = useVenueNetwork();
  const keys = useAgentKeys();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="panel p-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><KeyRound className="text-accent" />Agent keys</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted leading-relaxed">
          Perps and options each let your wallet approve a separate <b className="text-white">agent key</b> that signs orders for you.
          MetaMask only signs once to approve it. The key is created and kept encrypted on the Pulse Risk backend, so the hedging and
          rebalancing agent can act while you&apos;re away. Its permissions are limited: it can never send funds to anyone but you.
        </p>
        <div className="mt-3 text-xs text-muted">Network: <span className="text-white capitalize">{network}</span> (switch in the sidebar). Keys are per network.</div>
      </div>
      {!isConnected ? <div className="panel p-6 text-muted">Connect MetaMask first.</div>
        : !wallet ? <div className="panel p-6"><p className="mb-3 text-sm text-muted">Sign in (a message, no gas) so the backend knows this wallet is yours.</p><button className="btn-primary" disabled={signingIn} onClick={() => void signIn()}>{signingIn ? 'Signing…' : 'Sign in'}</button></div>
        : <div className="grid gap-4 md:grid-cols-2">
          {(['aster', 'derive'] as const).map((v) => <VenueCard key={v} venue={v} row={keys.data?.find((k) => k.venue === v && k.network === network)} />)}
        </div>}
    </div>
  );
}

function VenueCard({ venue, row }: { venue: 'aster' | 'lighter' | 'derive'; row?: AgentKeyRow }) {
  const meta = VENUES[venue];
  const { network } = useVenueNetwork();
  const { chainId } = useAccount();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = row?.status === 'active';

  async function register() {
    setErr(null);
    try {
      if (venue === 'aster') {
        setStep('Generating the agent key…');
        const prep = await getJson<{ typedData: AsterTypedData; msg: string; agent: string; expiresAt: number }>('/api/agent/register/aster', { method: 'POST', body: JSON.stringify({ network, step: 'prepare' }) });
        const want = prep.typedData.domain.chainId;
        // The approval is chain-bound typed data: MetaMask must be on BNB Chain (testnet: BNB testnet) to sign it.
        if (chainId !== want) { setStep(`Switch MetaMask to ${want === bsc.id ? 'BNB Chain' : 'BNB testnet'}…`); await switchChainAsync({ chainId: want as 56 | 97 }); }
        setStep(`Approve agent ${shortAddr(prep.agent)} in MetaMask (trade only, never withdraw)…`);
        const signature = await signTypedDataAsync({ domain: prep.typedData.domain, types: prep.typedData.types, primaryType: 'Message', message: prep.typedData.message });
        setStep('Registering with perps…');
        await getJson('/api/agent/register/aster', { method: 'POST', body: JSON.stringify({ network, step: 'finalize', signature }) });
      } else if (venue === 'lighter') {
        setStep('Generating key and signing ChangePubKey…');
        const prep = await getJson<{ messageToSign: string; accountIndex: number }>('/api/agent/register/lighter', { method: 'POST', body: JSON.stringify({ network, step: 'prepare' }) });
        setStep(`Approve in MetaMask (perps account #${prep.accountIndex})…`);
        const signature = await signMessageAsync({ message: prep.messageToSign });
        setStep('Submitting to perps and waiting for the key to go live…');
        await getJson('/api/agent/register/lighter', { method: 'POST', body: JSON.stringify({ network, step: 'finalize', signature }) });
      } else {
        setStep('Preparing session key…');
        const prep = await getJson<{ chainId: number; loginMessage: string; setKeyTypedData: TypedData; whitelistTypedData: TypedData; subaccountId: number }>('/api/agent/register/derive', { method: 'POST', body: JSON.stringify({ network, step: 'prepare' }) });
        const original = chainId;
        if (chainId !== prep.chainId) { setStep('Switch MetaMask to ' + (prep.chainId === 1 ? 'Ethereum' : 'Sepolia') + ' (typed data is chain-bound)…'); await switchChainAsync({ chainId: prep.chainId as 1 | 11155111 }); }
        setStep('1/3 Approve the session key…');
        const setKey = await signTypedDataAsync(toSignable(prep.setKeyTypedData));
        setStep('2/3 Whitelist your own wallet for withdrawals…');
        const whitelist = await signTypedDataAsync(toSignable(prep.whitelistTypedData));
        setStep('3/3 Sign the login timestamp…');
        const login = await signMessageAsync({ message: prep.loginMessage });
        setStep('Registering with options…');
        await getJson('/api/agent/register/derive', { method: 'POST', body: JSON.stringify({ network, step: 'finalize', setKey, whitelist, login }) });
        if (original === bsc.id) await switchChainAsync({ chainId: bsc.id }).catch(() => undefined);
      }
      setStep(null);
    } catch (e) {
      setErr((e as Error).message.split('\n')[0]); setStep(null);
    } finally { void qc.invalidateQueries({ queryKey: ['agent-keys'] }); void qc.invalidateQueries({ queryKey: ['derive-account'] }); void qc.invalidateQueries({ queryKey: ['aster-account'] }); }
  }

  async function forget() {
    await getJson(`/api/agent/keys?venue=${venue}&network=${network}`, { method: 'DELETE' }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['agent-keys'] });
  }

  return (
    <div className="panel flex min-w-0 flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <div><div className={clsx('text-lg font-semibold', meta.color)}>{meta.name}</div><div className="text-xs text-muted">{meta.kind} · {network}</div></div>
        <span className={clsx('pill text-xs', active ? 'bg-up/15 text-up' : row ? 'bg-accent/15 text-accent' : 'bg-panel2 text-muted')}>{active ? 'Active' : row ? 'Pending' : 'Not registered'}</span>
      </div>
      {row && (
        <div className="rounded-xl bg-bg p-3 text-xs space-y-1 num">
          <div className="flex justify-between"><span className="text-muted">{venue === 'aster' ? 'Account' : venue === 'lighter' ? 'Account index' : 'Subaccount'}</span><span>{venue === 'aster' ? shortAddr(row.account_ref) : row.account_ref}</span></div>
          <div className="flex justify-between"><span className="text-muted">{venue === 'lighter' ? 'API key index' : venue === 'aster' ? 'Agent' : 'Session key'}</span><span>{venue === 'lighter' ? row.key_ref : shortAddr(row.key_ref)}</span></div>
          <div className="flex justify-between gap-4"><span className="shrink-0 text-muted">Scope</span>
            <span className="flex min-w-0 flex-wrap justify-end gap-1">{row.scope.split(',').map((sc) => <span key={sc} className="rounded bg-panel2 px-1.5 py-0.5 text-[11px]">{sc}</span>)}</span></div>
          {row.expires_at && <div className="flex justify-between"><span className="text-muted">Expires</span><span>{new Date(row.expires_at > 1e12 ? row.expires_at : row.expires_at * 1000).toLocaleDateString()}{row.expires_at > 1e12 && row.expires_at < Date.now() ? ' (expired: rotate)' : ''}</span></div>}
        </div>
      )}
      <div className="text-sm">
        <div className="mb-1 text-muted">The agent can</div>
        {meta.can.map((c) => <div key={c} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-up" />{c}</div>)}
        <div className="mb-1 mt-3 text-muted">It cannot</div>
        {meta.cannot.map((c) => <div key={c} className="flex gap-2"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-down" />{c}</div>)}
      </div>
      <div className="text-xs text-muted">Requires: {meta.sign}.{venue === 'aster' ? ' The agent expires after 180 days; rotate it before then.' : ` Your ${meta.name} account must exist (first deposit creates it).`}</div>
      <div className="mt-auto flex gap-2">
        <button className="btn-primary flex-1" disabled={!!step} onClick={() => void register()}>{step ? 'Working…' : active ? 'Rotate key' : 'Register agent'}</button>
        {row && <button className="btn-ghost" onClick={() => void forget()} title="Forget locally. To revoke at the venue, rotate the key.">Forget</button>}
      </div>
      {step && <div className="rounded-xl bg-panel2 px-3 py-2 text-xs">{step}</div>}
      {err && <div className="rounded-xl bg-down/10 px-3 py-2 text-xs text-down break-words">{err}</div>}
    </div>
  );
}
