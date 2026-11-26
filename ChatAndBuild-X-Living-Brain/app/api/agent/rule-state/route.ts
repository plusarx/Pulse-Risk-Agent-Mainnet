import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { mergeRuleState, readRuleStates } from '@/lib/server/agent-store';

/** The signed-in wallet's rule runtime state (written by the agent). */
export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ states: readRuleStates(wallet, n) });
  });
}

/** POST { network, ruleKey, action: 'rearm' } — clears a run-once rule's "done" markers so it can move again. */
export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const b = (await req.json().catch(() => ({}))) as { network?: string; ruleKey?: string; action?: string };
    const n = netParam(b.network);
    if (!n || !b.ruleKey || !/^(aster|lighter|derive):\d{0,24}$/.test(b.ruleKey) || b.action !== 'rearm') return json({ error: 'network, ruleKey, action=rearm required' }, 400);
    return json({ state: mergeRuleState(wallet, n, b.ruleKey, { topUpDoneAt: null, releaseDoneAt: null }) });
  });
}
