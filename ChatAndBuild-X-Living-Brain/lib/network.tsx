'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Applies to Lighter + Derive only. bStocks on BSC are mainnet-only. */
export type VenueNetwork = 'mainnet' | 'testnet';

const Ctx = createContext<{ network: VenueNetwork; setNetwork: (n: VenueNetwork) => void }>({
  network: 'mainnet',
  setNetwork: () => {},
});

const KEY = 'pulse-risk.venueNetwork';

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setState] = useState<VenueNetwork>('mainnet');
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'mainnet' || v === 'testnet') setState(v);
    } catch { /* storage unavailable — default mainnet */ }
  }, []);
  const setNetwork = useCallback((n: VenueNetwork) => {
    setState(n);
    try { localStorage.setItem(KEY, n); } catch { /* ignore */ }
  }, []);
  return <Ctx.Provider value={{ network, setNetwork }}>{children}</Ctx.Provider>;
}

export const useVenueNetwork = () => useContext(Ctx);
