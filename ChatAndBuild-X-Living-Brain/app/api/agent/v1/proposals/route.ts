import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { createProposal } from '@/lib/server/agent-store';
import { ProposalIn } from '@/lib/agent-proposal';

/** Agent service: submit a risk-analyst proposal. It stays pending until the user approves it in the UI. */
export async function POST(req: Request) {
  return withAgent(async () => {
    const p = ProposalIn.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    return json({ ok: true, ...createProposal(p.data) });
  });
}
