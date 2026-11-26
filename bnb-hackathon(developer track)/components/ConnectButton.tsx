'use client';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { Wallet, LogOut, ShieldCheck } from 'lucide-react';
import { shortAddr } from '@/lib/format';
import { WalletPicker } from '@/components/WalletPicker';
import { useSession } from '@/lib/session';

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { wallet, signIn, signOut, signingIn } = useSession();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // Clicks inside the wallet picker (rendered on <body>, outside this element) must not count as outside clicks.
    const h = (e: MouseEvent) => { const t = e.target as Element; if (t.closest?.('[data-wallet-picker]')) return; if (ref.current && !ref.current.contains(t)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!mounted) return <div className="h-10 w-40" />;

  if (!isConnected) {
    // Every wallet the browser announces (EIP-6963: MetaMask, Trust Wallet, Rabby, ...) is offered; the user picks.
    // The generic `injected` connector is only a fallback for old wallets that don't announce themselves.
    const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected');
    const hasLegacy = typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum;
    const legacy = connectors.find((c) => c.id === 'injected');
    const wallets = discovered.length ? discovered : hasLegacy && legacy ? [legacy] : [];
    if (!wallets.length) {
      return (
        <a className="pill bg-white text-black font-medium px-5 py-2.5" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          <span className="flex items-center gap-2"><Wallet size={16} />Install a wallet</span>
        </a>
      );
    }
    const go = (c: (typeof wallets)[number]) => { setOpen(false); connect({ connector: c, chainId: bsc.id }); };
    const only = wallets.length === 1 ? wallets[0] : null;
    return (
      <div className="relative flex flex-col items-end" ref={ref}>
        <button className="pill bg-white text-black font-medium px-5 py-2.5" disabled={isPending}
          onClick={() => (only ? go(only) : setOpen((o) => !o))}>
          <span className="flex items-center gap-2"><Wallet size={16} />{isPending ? 'Connecting…' : only ? `Connect ${only.id === 'injected' ? 'wallet' : only.name}` : 'Connect wallet'}</span>
        </button>
        {open && !only && <WalletPicker wallets={wallets} pending={isPending} onPick={go} onClose={() => setOpen(false)} />}
        {error && <span className="mt-1 max-w-xs text-right text-xs text-down">{error.message.split('\n')[0]}</span>}
      </div>
    );
  }

  const signedIn = wallet && address && wallet.toLowerCase() === address.toLowerCase();
  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      {chainId !== bsc.id && (
        <button className="pill bg-accent/15 text-accent" onClick={() => switchChain({ chainId: bsc.id })}>Switch to BNB Chain</button>
      )}
      {!signedIn && (
        <button className="pill bg-panel2 text-white" onClick={() => void signIn()} disabled={signingIn}
          title="Signs a message (no gas) so the agent backend knows this wallet is yours">
          {signingIn ? 'Signing…' : 'Sign in'}
        </button>
      )}
      <button className="pill bg-panel2 text-white flex items-center gap-2 py-2.5" onClick={() => setOpen((o) => !o)}>
        <span className="h-2 w-2 rounded-full bg-up" />
        <span className="num">{shortAddr(address)}</span>
        {signedIn && <ShieldCheck size={14} className="text-up" />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 panel p-2 shadow-xl">
          <div className="px-3 py-2 text-xs text-muted">{signedIn ? 'Signed in to agent backend' : 'Not signed in'}</div>
          {signedIn && <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel2" onClick={() => { void signOut(); setOpen(false); }}>Sign out</button>}
          <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel2 flex items-center gap-2 text-down"
            onClick={() => { void signOut(); disconnect(); setOpen(false); }}><LogOut size={14} />Disconnect</button>
        </div>
      )}
    </div>
  );
}
