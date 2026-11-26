'use client';
import { useState } from 'react';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { sendTransaction, waitForTransactionReceipt } from 'wagmi/actions';
import { encodeFunctionData, type Abi, type Address } from 'viem';

export interface Log { text: string; kind: 'info' | 'ok' | 'err'; href?: string }
const EXPLORER: Record<number, string> = { 56: 'https://bscscan.com/tx/', 1: 'https://etherscan.io/tx/', 11155111: 'https://sepolia.etherscan.io/tx/' };

/** Sequential tx runner: switches chain, sends, waits for each receipt, logs progress. */
export function useTxRunner() {
  const config = useConfig();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (l: Log) => setLogs((x) => [...x, l]);

  async function ensureChain(id: number) {
    if (chainId !== id) await switchChainAsync({ chainId: id as 56 | 1 | 11155111 });
  }
  async function wait(hash: `0x${string}`, cid: number, label: string) {
    log({ text: `${label}: submitted`, kind: 'info', href: EXPLORER[cid] + hash });
    const r = await waitForTransactionReceipt(config, { hash, chainId: cid as 56 });
    if (r.status !== 'success') throw new Error(`${label} reverted`);
    log({ text: `${label}: confirmed`, kind: 'ok', href: EXPLORER[cid] + hash });
  }
  async function raw(cid: number, label: string, to: Address, data: `0x${string}`) {
    await ensureChain(cid);
    const hash = await sendTransaction(config, { to, data, value: 0n, chainId: cid as 56 });
    await wait(hash, cid, label);
  }
  async function call(cid: number, label: string, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
    await raw(cid, label, address, encodeFunctionData({ abi, functionName, args }));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true); setLogs([]);
    try { await fn(); } catch (e) { log({ text: (e as Error).message.split('\n')[0], kind: 'err' }); } finally { setBusy(false); }
  }
  return { logs, busy, log, raw, call, run };
}
