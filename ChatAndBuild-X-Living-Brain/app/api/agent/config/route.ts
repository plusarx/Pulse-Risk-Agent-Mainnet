import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { AgentConfig } from '@/lib/agent-config';
import { readConfig, writeConfig } from '@/lib/server/agent-store';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ config: readConfig(wallet, n) });
  });
}

export async function PUT(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    const parsed = AgentConfig.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    writeConfig(wallet, n, parsed.data);
    return json({ config: parsed.data });
  });
}
