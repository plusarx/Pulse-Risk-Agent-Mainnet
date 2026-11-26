import { getAddress } from 'viem';
import { json } from '@/lib/server/auth';

/** Public info about the agent service: the BSC address users grant a (capped) allowance to. */
export async function GET() {
  let bscAddress: string | null = null;
  try { bscAddress = process.env.AGENT_BSC_ADDRESS ? getAddress(process.env.AGENT_BSC_ADDRESS) : null; } catch { bscAddress = null; }
  return json({ bscAddress });
}
