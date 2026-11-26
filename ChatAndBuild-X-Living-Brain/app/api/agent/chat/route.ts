import { z } from 'zod';
import { json, sessionWallet } from '@/lib/server/auth';
import { listActions } from '@/lib/server/agent-actions';
import { listEvents } from '@/lib/server/agent-store';
import { getDb } from '@/lib/server/db';

// Browser -> this route -> the agent's chat service (agent/src/server.ts, npm run chat). The browser never holds the token and never talks to the
// agent. Signed in: the wallet comes from the session cookie (never from the body), the chat reads that wallet's live accounts and the recorded
// actions and events come from the app's own database. Not signed in: the chat still answers, but only about the labelled SAMPLE portfolio, with no
// account data and no recorded history, and with a small per-client rate limit because each answer costs model tokens.
// The chat service cannot execute, approve or save anything: it answers, and it can run the hedging agent on changed values as a dry test.
const AGENT_CHAT_URL = process.env.AGENT_CHAT_URL ?? 'http://127.0.0.1:3200';
const ANON_WALLET = '0x0000000000000000000000000000000000000000';
const Body = z.object({
  network: z.string().optional(), message: z.string().trim().min(1).max(1200),
  // Earlier answers can be long (multi-scenario replies): trim them to the context size instead of refusing the message.
  history: z.array(z.object({ role: z.enum(['user', 'agent']), text: z.string().max(50_000).transform((t) => t.slice(0, 1600)) })).max(50).transform((h) => h.slice(-20)).default([]),
});

function defaultWallet(): string | null {
  const env = process.env.CHAT_DEFAULT_WALLET?.trim(); if (env && /^0x[0-9a-fA-F]{40}$/.test(env)) return env;
  const r = getDb().prepare(`SELECT wallet FROM agent_keys WHERE network = 'mainnet' AND status = 'active' UNION SELECT wallet FROM agent_config WHERE network = 'mainnet' LIMIT 1`).get() as { wallet: string } | undefined;
  return r?.wallet ?? null;
}
const hits = new Map<string, { n: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(); const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 500) for (const [k, v] of hits) if (v.reset < now) hits.delete(k); return false; }
  h.n++; return h.n > max;
}

export async function POST(req: Request) {
  try {
    const token = process.env.AGENT_API_TOKEN;
    if (!token) return json({ error: 'AGENT_API_TOKEN is not set on the app' }, 500);
    const b = Body.safeParse(await req.json().catch(() => null));
    if (!b.success) return json({ error: b.error.issues.some((i) => i.path[0] === 'message') ? 'Type a message (up to 1,200 characters).' : 'The chat could not read the conversation. Press Clear chat and ask again.' }, 400);
    // The chat always reads MAINNET: bStocks and the real positions live there, whatever the venue toggle in the header says.
    const n = 'mainnet' as const;
    // No sign-in needed to chat. Signed out, the chat reads this app's own registered wallet (CHAT_DEFAULT_WALLET, else the first wallet with agent
    // keys or settings on mainnet): this is a single-owner app. Approve and Decline still need a signed-in session.
    const session = await sessionWallet();
    const wallet = session ?? defaultWallet();
    if (!session && limited(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local', 12, 60_000)) return json({ error: 'Too many questions. Wait a minute or sign in.' }, 429);
    const recorded = wallet ? {
      actions: listActions(wallet, n, 6).map((a) => ({ id: a.id, status: a.status, title: a.title, why: a.why, created_at: a.created_at, result_message: a.result_message })),
      events: (listEvents(wallet, n, 12) as { kind: string; status: string | null; message: string; created_at: number | null }[]).map((e) => ({ kind: e.kind, status: e.status, message: e.message, created_at: e.created_at })),
    } : { actions: [], events: [] };
    let r: Response;
    try {
      r = await fetch(`${AGENT_CHAT_URL}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: wallet ?? ANON_WALLET, signedIn: !!session, network: n, message: b.data.message, history: b.data.history, recorded }), signal: AbortSignal.timeout(175_000) });
    } catch {
      return json({ error: `The agent chat service is not reachable at ${AGENT_CHAT_URL}. Start it with "npm run chat" in the agent folder.` }, 502);
    }
    const out = await r.json().catch(() => ({ error: 'the agent chat service sent something that is not JSON' })) as { error?: string; ui?: { showPending?: boolean; showActivity?: boolean } };
    if (!r.ok) return json(out, r.status === 401 ? 502 : r.status);
    // What the chat shows next to the answer comes from the app's own database, never from the model: the pending requests (with their Approve and
    // Decline buttons) and the recent activity, for the signed-in wallet only.
    const pending = wallet && out.ui?.showPending ? listActions(wallet, n, 20).filter((a) => a.status === 'pending') : [];
    const activity = wallet && out.ui?.showActivity ? { actions: listActions(wallet, n, 5), events: (listEvents(wallet, n, 8) as { id: number; kind: string; status: string | null; message: string; created_at: number }[]).map((e) => ({ id: e.id, kind: e.kind, status: e.status, message: e.message, created_at: e.created_at })) } : null;
    return json({ ...out, pending, activity });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
