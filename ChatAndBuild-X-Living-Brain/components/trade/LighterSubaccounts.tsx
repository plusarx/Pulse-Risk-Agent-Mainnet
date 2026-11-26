'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { getJson, lighterAccountName, useLighterAgentAccounts, type LighterAccountView } from '@/lib/hooks/useVenues';
import { fmtUsd } from '@/lib/format';

const newIdem = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Lighter sub-accounts: create one, enable the agent key on it (one MetaMask signature — the SAME agent
 * key is registered on the sub), move USDC between your own accounts (instant), and pick one to trade from.
 */
export function LighterSubaccounts({ accounts, onTradeFrom }: { accounts: LighterAccountView[]; onTradeFrom: (index: number) => void }) {
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const agent = useLighterAgentAccounts();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const status = (i: number) => agent.data?.find((a) => a.index === i)?.agent ?? 'none';
  const masterActive = agent.data?.some((a) => a.isMaster && a.agent === 'active');
  const refresh = () => { for (const ms of [0, 2_000, 6_000]) setTimeout(() => { void qc.invalidateQueries({ queryKey: ['lighter-account'] }); void qc.invalidateQueries({ queryKey: ['lighter-agent-accounts'] }); }, ms); };
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); refresh(); } catch (e) { setMsg({ ok: false, text: (e as Error).message.split('\n')[0] }); } finally { setBusy(null); }
  };
  const post = <T,>(body: object, idem = false) => getJson<T>('/api/trade/lighter-accounts', { method: 'POST', headers: { 'content-type': 'application/json', ...(idem ? { 'idempotency-key': newIdem() } : {}) }, body: JSON.stringify({ network, ...body }) });

  if (!accounts.length) return <p className="py-6 text-center text-sm text-muted">No perps account yet. Deposit first.</p>;
  const f = from ?? accounts[0].index;
  const t = to ?? accounts.find((a) => a.index !== f)?.index ?? null;

  return (
    <div className="mt-2 space-y-3">
      <table className="w-full"><thead><tr>{['Account', 'Collateral', 'Available', 'Positions', 'Agent key', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
        {accounts.map((a) => {
          const st = a.account_type === 0 ? (masterActive ? 'active' : 'none') : status(a.index);
          return (
            <tr key={a.index} className="border-t border-line/60">
              <td className="td font-medium">{lighterAccountName(a)}</td>
              <td className="td">{fmtUsd(+a.collateral)}</td><td className="td">{fmtUsd(+a.available_balance)}</td>
              <td className="td">{a.positions.filter((p) => +p.position !== 0).length}</td>
              <td className="td"><span className={clsx('rounded px-1.5 py-0.5 text-[11px]', st === 'active' ? 'bg-up/10 text-up' : st === 'pending' ? 'bg-accent/10 text-accent' : 'bg-panel2 text-muted')}>{st === 'active' ? 'active' : st === 'pending' ? 'pending' : 'not enabled'}</span></td>
              <td className="td text-right">
                {st !== 'active' && a.account_type !== 0 && masterActive ? (
                  <button disabled={!!busy} className="text-xs text-accent disabled:opacity-40" onClick={() => void run(`enable-${a.index}`, async () => {
                    const { messageToSign } = await post<{ messageToSign: string }>({ action: 'enableAgent', index: a.index });
                    const signature = await signMessageAsync({ message: messageToSign });
                    await post({ action: 'enableAgentFinalize', signature });
                    return `Agent key enabled on Sub #${a.index}`;
                  })}>{busy === `enable-${a.index}` ? 'Enabling…' : 'Enable agent'}</button>
                ) : st === 'active' ? <button className="text-xs text-accent" onClick={() => onTradeFrom(a.index)}>Trade from</button> : null}
              </td>
            </tr>
          );
        })}
      </tbody></table>

      <div className="flex flex-wrap items-start gap-3">
        <button disabled={!!busy || !masterActive} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-2 text-sm"
          title={masterActive ? 'Signed by the agent key on your main account — no MetaMask popup' : 'Register the perps agent first'}
          onClick={() => void run('create', async () => {
            const r = await post<{ index: number | null; txHash: string }>({ action: 'create' }, true);
            return r.index ? `Created Sub #${r.index}. Enable the agent on it, then move USDC in.` : 'Sub-account submitted; it appears in a few seconds.';
          })}><Plus size={14} />{busy === 'create' ? 'Creating…' : 'New sub-account'}</button>

        {accounts.length > 1 && (
          <div className="flex flex-1 flex-wrap items-center gap-2 rounded-xl bg-bg p-2 text-sm">
            <span className="text-muted">Move USDC</span>
            <select className="input w-auto py-1.5 text-sm" value={f} onChange={(e) => setFrom(+e.target.value)}>{accounts.map((a) => <option key={a.index} value={a.index}>{lighterAccountName(a)} · ${(+a.available_balance).toFixed(2)}</option>)}</select>
            <span className="text-muted">→</span>
            <select className="input w-auto py-1.5 text-sm" value={t ?? ''} onChange={(e) => setTo(+e.target.value)}>{accounts.filter((a) => a.index !== f).map((a) => <option key={a.index} value={a.index}>{lighterAccountName(a)}</option>)}</select>
            <input className="input w-24 py-1.5 text-sm" inputMode="decimal" placeholder="USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn-primary px-3 py-1.5 text-sm" disabled={!!busy || t === null || !(Number(amount) >= 1)} onClick={() => void run('move', async () => {
              await post({ action: 'move', from: f, to: t, amount }, true);
              setAmount('');
              return `Moved ${amount} USDC`;
            })}>{busy === 'move' ? 'Moving…' : 'Move'}</button>
          </div>
        )}
      </div>
      {msg && <div className={clsx('rounded-xl px-3 py-2 text-xs', msg.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{msg.text}</div>}
      <p className="text-[11px] text-muted">Transfers between your own perps accounts are instant and free. Moving out of a sub-account needs the agent enabled on that sub.</p>
    </div>
  );
}
