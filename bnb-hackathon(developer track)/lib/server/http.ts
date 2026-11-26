import 'server-only';
import type { Address } from 'viem';
import type { VenueNetwork } from '@/lib/network';
import { json, sessionWallet } from './auth';

export function netParam(v: string | null | undefined): VenueNetwork | null {
  return v === 'mainnet' || v === 'testnet' ? v : null;
}

/** Wraps a handler that needs a signed-in wallet. Identity comes from the session cookie only. */
export async function withWallet(fn: (wallet: Address) => Promise<Response>): Promise<Response> {
  const wallet = await sessionWallet();
  if (!wallet) return json({ error: 'Sign in with your wallet first' }, 401);
  try {
    return await fn(wallet);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api]', msg);
    return json({ error: msg }, 400);
  }
}
