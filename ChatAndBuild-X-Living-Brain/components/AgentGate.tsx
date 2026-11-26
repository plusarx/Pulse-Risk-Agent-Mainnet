'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import { useAgentKeys } from '@/lib/hooks/useVenues';

/** Renders children only when the wallet is signed in and has an active agent key for this venue. */
export function AgentGate({ venue, hasAccount, children }: { venue: 'aster' | 'lighter' | 'derive'; hasAccount: boolean | null; children: ReactNode }) {
  const { isConnected } = useAccount();
  const { wallet, signIn, signingIn } = useSession();
  const { network } = useVenueNetwork();
  const keys = useAgentKeys();
  const key = keys.data?.find((k) => k.venue === venue && k.network === network);
  const name = venue === 'derive' ? 'Options' : 'Perps';
  const box = (title: string, body: ReactNode) => (
    <div className="rounded-xl bg-bg p-4 text-sm"><div className="mb-1 font-medium">{title}</div><div className="text-muted leading-relaxed">{body}</div></div>
  );
  if (!isConnected) return box('Connect MetaMask', 'Connect your wallet to trade.');
  if (!wallet) return box('Sign in', <>Sign a message (no gas) so the backend can sign {name} orders with your agent key.<button className="btn-primary mt-3 w-full" disabled={signingIn} onClick={() => void signIn()}>{signingIn ? 'Signing…' : 'Sign in'}</button></>);
  if (hasAccount === false) return box(venue === 'aster' ? 'Deposit to start trading perps' : `No ${name} account yet`, <>{venue === 'aster' ? 'Deposit USDT from BNB Chain to fund your perps margin.' : 'Your first deposit creates it.'} <Link className="text-accent underline" href="/funding">Deposit →</Link></>);
  if (!key || key.status !== 'active') return box(`Register a ${name} agent`, <>{name} trades are signed by an agent key, so there&apos;s no MetaMask popup per order. One signature registers it. <Link className="text-accent underline" href="/agents">Agent keys →</Link></>);
  return <>{children}</>;
}
