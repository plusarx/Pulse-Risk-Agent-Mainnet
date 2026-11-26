import { z } from 'zod';
import { json, sessionWallet } from '@/lib/server/auth';

// The Memory tab in the chat -> this route -> the agent's chat service (/memory, backed by Living Brain). Memory belongs to the signed-in wallet:
// the wallet comes from the session cookie, never from the body, and signed out there is no memory at all. The browser never holds the agent token.
const AGENT_CHAT_URL = process.env.AGENT_CHAT_URL ?? 'http://127.0.0.1:3200';

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pin'), id: z.string().min(1).max(200), pinned: z.boolean() }),
  z.object({ action: z.literal('forget'), id: z.string().min(1).max(200) }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('note'), text: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal('decision'), decision: z.enum(['approved', 'declined']), title: z.string().max(400), reason: z.string().max(300).optional() }),
]);

async function agent(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Response | null> {
  const token = process.env.AGENT_API_TOKEN; if (!token) return null;
  try { return await fetch(`${AGENT_CHAT_URL}${path}`, { method: init.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(60_000) }); }
  catch { return null; }
}

export async function GET() {
  const wallet = await sessionWallet();
  if (!wallet) return json({ enabled: false, signedOut: true, items: [], usage: null, note: 'Sign in with your wallet to use memory.' });
  const r = await agent(`/memory?wallet=${wallet}`, { method: 'GET' });
  if (!r) return json({ enabled: false, items: [], usage: null, note: 'The agent chat service is not reachable, so memory is unavailable.' });
  return json(await r.json().catch(() => ({ enabled: false, items: [], usage: null, note: 'The memory service sent something unreadable.' })), r.ok ? 200 : 502);
}

export async function POST(req: Request) {
  const wallet = await sessionWallet();
  if (!wallet) return json({ error: 'Sign in with your wallet to use memory.' }, 401);
  const a = Action.safeParse(await req.json().catch(() => null));
  if (!a.success) return json({ error: 'That memory action was not understood.' }, 400);
  const path = a.data.action === 'pin' ? '/memory/pin' : a.data.action === 'forget' ? '/memory/forget' : a.data.action === 'clear' ? '/memory/clear' : a.data.action === 'note' ? '/memory/note' : '/memory/decision';
  const { action: _a, ...rest } = a.data; void _a;
  const r = await agent(path, { method: 'POST', body: { wallet, ...rest } });
  if (!r) return json({ error: 'The agent chat service is not reachable, so memory is unavailable.' }, 502);
  return json(await r.json().catch(() => ({ error: 'unreadable' })), r.ok ? 200 : r.status === 401 ? 502 : r.status);
}
