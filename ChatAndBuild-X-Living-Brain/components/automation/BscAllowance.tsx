'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useReadContracts } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { erc20Abi, maxUint256, type Address } from 'viem';
import { Wallet } from 'lucide-react';
import { BSC_USDC, BSC_USDT } from '@/lib/bsc';
import { bstockBySymbol } from '@/lib/bstocks';
import { fmtUnits, safeParseUnits, shortAddr } from '@/lib/format';
import { getJson } from '@/lib/hooks/useVenues';
import { useBscBalances } from '@/lib/hooks/useBscBalances';
import { useTxRunner } from '@/components/funding/useTxRunner';

/**
 * The agent can only move BNB-side funds the user has explicitly allowed: a capped ERC-20 allowance
 * to the agent's BSC address (revocable any time by setting it to 0). The agent then transferFrom's
 * up to the cap and bridges with Relay straight into the user's OWN Lighter account / Ethereum address.
 */
export function BscAllowance({ sellOrder, dailyCapUsd }: { sellOrder: string[]; dailyCapUsd: number }) {
  const { address } = useAccount();
  const info = useQuery({ queryKey: ['agent-info'], queryFn: () => getJson<{ bscAddress: Address | null }>('/api/agent/info') });
  const agent = info.data?.bscAddress ?? null;
  const tokens: { label: string; address: Address }[] = [
    { label: 'USDC', address: BSC_USDC }, { label: 'USDT', address: BSC_USDT },
    ...sellOrder.map((s) => bstockBySymbol(s)).filter((t) => !!t).map((t) => ({ label: t!.symbol, address: t!.address })),
  ];
  const reads = useReadContracts({
    contracts: address && agent ? tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'allowance' as const, args: [address, agent] as const, chainId: bsc.id })) : [],
    query: { enabled: !!address && !!agent, refetchInterval: 6_000 },
  });
  const tx = useTxRunner();
  const bal = useBscBalances();
  const [cap, setCap] = useState(String(dailyCapUsd));

  if (!agent) return <div className="rounded-xl bg-bg p-3 text-xs text-muted">The agent service&apos;s BSC address isn&apos;t configured yet (<code>AGENT_BSC_ADDRESS</code>). Once it is, you can grant it a capped allowance here.</div>;
  const set = (t: { label: string; address: Address }, amount: bigint) => tx.run(async () => { await tx.call(bsc.id, `${amount === 0n ? 'Revoke' : 'Allow'} ${t.label}`, t.address, erc20Abi, 'approve', [agent, amount]); await reads.refetch(); });
  const capUnits = safeParseUnits(cap, 18);
  return (
    <div className="rounded-xl bg-bg p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium"><Wallet size={15} />Agent allowance on BNB</div>
      <p className="mb-2 text-xs text-muted">The agent ({shortAddr(agent)}) can only pull what you allow here, and only to fund <b>your own</b> venue accounts. For each bStock it may <b>sell</b> to fund a top-up, allow it to the agent. Set it to 0 to revoke.</p>
      <div className="mb-2 flex items-center gap-2"><span className="text-xs text-muted">Stable cap</span><input className="input py-1.5 text-sm" value={cap} onChange={(e) => setCap(e.target.value)} /><span className="text-xs text-muted">USD</span></div>
      {tokens.map((t, i) => {
        const cur = reads.data?.[i]?.result as bigint | undefined;
        const isStable = t.label === 'USDC' || t.label === 'USDT';
        return (
          <div key={t.label} className="flex items-center justify-between border-t border-line/60 py-1.5 text-xs">
            <span>{t.label}</span>
            <span className="num text-muted">{cur === undefined ? '—' : cur >= maxUint256 / 2n ? 'unlimited' : fmtUnits(cur, 18, 2)}</span>
            <span className="flex gap-2">
              <button className="text-accent disabled:opacity-40" disabled={tx.busy || (isStable && !capUnits)}
                onClick={() => void set(t, isStable ? capUnits! : (bal.holdings.find((h) => h.symbol === t.label)?.raw ?? 0n))}
                title={isStable ? '' : 'Allow exactly your current holding (raw units) so the agent can sell it'}>{isStable ? 'Set cap' : 'Allow holding'}</button>
              <button className="text-down disabled:opacity-40" disabled={tx.busy || !cur} onClick={() => void set(t, 0n)}>Revoke</button>
            </span>
          </div>
        );
      })}
      {tx.logs.length > 0 && <div className="mt-2 text-xs text-muted">{tx.logs[tx.logs.length - 1].text}</div>}
    </div>
  );
}
