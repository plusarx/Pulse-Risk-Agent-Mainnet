import { venueWords } from '@/lib/venue-words';
import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getAddress, verifyMessage, type Address } from 'viem';
import { getDb } from './db';
import { safeEqual } from './crypto';

const COOKIE = 'px_session';
const SESSION_TTL_S = 12 * 3600;
const NONCE_TTL_MS = 5 * 60_000;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is not set (>= 32 chars). See .env.example');
  return s;
}

export function loginMessage(address: Address, nonce: string, origin: string): string {
  return [
    `${origin} wants you to sign in with your wallet:`,
    address,
    '',
    'Sign in to Pulse Risk. This does not send a transaction or cost gas.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n');
}

export function issueNonce(address: Address): string {
  const nonce = randomBytes(16).toString('hex');
  getDb().prepare('INSERT OR REPLACE INTO auth_nonces (address, nonce, issued_at) VALUES (?, ?, ?)')
    .run(address.toLowerCase(), nonce, Date.now());
  return nonce;
}

export async function verifyLogin(address: Address, signature: `0x${string}`, origin: string): Promise<boolean> {
  const row = getDb().prepare('SELECT nonce, issued_at FROM auth_nonces WHERE address = ?')
    .get(address.toLowerCase()) as { nonce: string; issued_at: number } | undefined;
  if (!row || Date.now() - row.issued_at > NONCE_TTL_MS) return false;
  // Single use, consumed before verification so a failed attempt can't be retried with the same nonce.
  getDb().prepare('DELETE FROM auth_nonces WHERE address = ?').run(address.toLowerCase());
  return verifyMessage({ address, message: loginMessage(address, row.nonce, origin), signature });
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export async function setSession(address: Address): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const payload = `${address.toLowerCase()}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_TTL_S,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Wallet from the session cookie — identity never comes from the request body. */
export async function sessionWallet(): Promise<Address | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const parts = v.split('.');
  if (parts.length !== 3) return null;
  const [addr, exp, mac] = parts;
  if (!safeEqual(mac, sign(`${addr}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  try { return getAddress(addr); } catch { return null; }
}

/** The agent service authenticates with a static bearer token (AGENT_API_TOKEN). */
export async function isAgent(): Promise<boolean> {
  const token = process.env.AGENT_API_TOKEN;
  if (!token || token.length < 24) return false;
  const h = (await headers()).get('authorization') ?? '';
  return h.startsWith('Bearer ') && safeEqual(h.slice(7), token);
}

export function json(data: unknown, status = 200): Response {
  // Error text is shown to the user as is: it never names a venue (Lighter = perps, Derive = options). Data is untouched.
  const shown = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? { ...(data as object), error: venueWords((data as { error: string }).error) } : data;
  return Response.json(shown, { status, headers: { 'cache-control': 'no-store' } });
}
