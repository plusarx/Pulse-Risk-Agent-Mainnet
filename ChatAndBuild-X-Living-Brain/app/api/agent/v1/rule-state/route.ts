import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { RuleStateSchema } from '@/lib/agent-config';
import { mergeRuleState, readRuleStates } from '@/lib/server/agent-store';
import { netParam } from '@/lib/server/http';

/** Agent service: every rule's runtime state for one wallet, keyed by ruleKey. */
export async function GET(req: Request) {
  return withAgent(async () => {
    const u = new URL(req.url);
    const n = netParam(u.searchParams.get('network'));
    const wallet = u.searchParams.get('wallet') ?? '';
    if (!n || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: 'wallet, network required' }, 400);
    return json({ states: readRuleStates(wallet, n) });
  });
}

/**
 * Agent service: record a rule's runtime state — when a run-once direction fired (topUpDoneAt /
 * releaseDoneAt), when the release dwell started (releaseBelowSince), and the last outcome shown on
 * the rule's card. Fields omitted are kept; null clears. lastOutcomeAt is stamped server-side.
 */
export async function POST(req: Request) {
  return withAgent(async () => {
    const p = RuleStateSchema.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const { wallet, network, ruleKey, ...patch } = p.data;
    const stamped = patch.lastOutcome !== undefined ? { ...patch, lastOutcomeAt: new Date().toISOString() } : patch;
    return json({ state: mergeRuleState(wallet, network, ruleKey, stamped) });
  });
}
