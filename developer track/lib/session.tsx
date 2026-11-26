'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

interface SessionCtx {
  /** Server-verified wallet (signed in), or null. */
  wallet: string | null;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ wallet: null, signingIn: false, error: null, signIn: async () => {}, signOut: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [wallet, setWallet] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d: { address: string | null }) => setWallet(d.address)).catch(() => setWallet(null));
  }, []);

  // A session for a different wallet than the one connected is not valid for this UI.
  useEffect(() => {
    if (wallet && address && wallet.toLowerCase() !== address.toLowerCase()) {
      void fetch('/api/auth/logout', { method: 'POST' }).then(() => setWallet(null));
    }
  }, [wallet, address]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigningIn(true); setError(null);
    try {
      const { message } = (await (await fetch('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) })).json()) as { message: string };
      const signature = await signMessageAsync({ message });
      const r = await fetch('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature }) });
      const d = (await r.json()) as { address?: string; error?: string };
      if (!r.ok || !d.address) throw new Error(d.error ?? 'sign-in failed');
      setWallet(d.address);
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'sign-in failed');
    } finally { setSigningIn(false); }
  }, [address, signMessageAsync]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setWallet(null);
  }, []);

  return <Ctx.Provider value={{ wallet, signingIn, error, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
