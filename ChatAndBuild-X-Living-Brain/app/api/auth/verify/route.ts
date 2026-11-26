import { getAddress, isHex } from 'viem';
import { json, setSession, verifyLogin } from '@/lib/server/auth';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: string; signature?: string } | null;
  let address;
  try { address = getAddress(body?.address ?? ''); } catch { return json({ error: 'invalid address' }, 400); }
  const sig = body?.signature;
  if (!sig || !isHex(sig)) return json({ error: 'invalid signature' }, 400);
  const ok = await verifyLogin(address, sig, new URL(req.url).host).catch(() => false);
  if (!ok) return json({ error: 'signature rejected or nonce expired' }, 401);
  await setSession(address);
  return json({ address });
}
