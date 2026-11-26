'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, X } from 'lucide-react';
import type { Connector } from 'wagmi';

/**
 * The wallet chooser, drawn above the whole page (a portal on <body>), so no container can clip it. Matches the
 * site's terminal look: dark panel, gold ASCII frame title, mono labels. Esc, the close button or a click on the
 * backdrop closes it; focus moves into it when it opens.
 */
export function WalletPicker({ wallets, onPick, onClose, pending }: { wallets: readonly Connector[]; onPick: (c: Connector) => void; onClose: () => void; pending: boolean }) {
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    first.current?.focus();
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <div data-wallet-picker className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose a wallet">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl border border-line bg-[#07090d] p-5 pt-7 shadow-[0_0_60px_rgba(240,185,11,0.12)]">
        <span className="absolute -top-3 left-5 bg-[#07090d] px-2 font-mono text-[11px] uppercase tracking-[0.25em] text-accent">┤ connect ├</span>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1 text-muted hover:bg-white/5 hover:text-white"><X size={16} /></button>
        <div className="font-mono text-sm text-white">$ choose-wallet</div>
        <p className="mt-1 text-xs text-muted">Pick the wallet that holds your bStocks. You then sign one message (no gas) so the agent knows it is yours.</p>
        <div className="mt-4 space-y-2">
          {wallets.map((c, i) => (
            <button key={c.uid} ref={i === 0 ? first : undefined} type="button" disabled={pending} onClick={() => onPick(c)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left transition hover:border-accent/60 hover:bg-accent/[0.06] focus:border-accent focus:outline-none disabled:opacity-50">
              {/* Wallet icons are data: URIs announced by the extension (EIP-6963); next/image can't optimise those. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.icon ? <img src={c.icon} alt="" className="h-8 w-8 rounded-lg" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-panel2"><Wallet size={16} className="text-muted" /></span>}
              <span className="flex-1">
                <span className="block text-sm font-medium text-white">{c.id === 'injected' ? 'Browser wallet' : c.name}</span>
                <span className="block font-mono text-[10px] text-muted">detected · BNB Smart Chain</span>
              </span>
              <span className="font-mono text-xs text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-dashed border-line pt-3 font-mono text-[10px] leading-4 text-muted">
          Non-custodial: funds stay in your wallet. Don&apos;t see yours? <a className="text-accent underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">install a wallet ↗</a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
