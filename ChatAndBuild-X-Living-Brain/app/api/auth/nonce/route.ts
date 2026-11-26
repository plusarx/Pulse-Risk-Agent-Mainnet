import { getAddress } from 'viem';
import { issueNonce, json, loginMessage } from '@/lib/server/auth';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  let address;
  try { address = getAddress(body?.address ?? ''); } catch { return json({ error: 'invalid address' }, 400); }
  const nonce = issueNonce(address);
  return json({ message: loginMessage(address, nonce, new URL(req.url).host) });
}
