// Pin the safe settings BEFORE anything reads the config: this process only chats and runs dry what-ifs. It never signs, sends or posts.
process.env.DRY_RUN = 'true'; process.env.ALLOW_LIVE = 'no'; process.env.POST_EVENTS = 'false'; process.env.LLM_MODE = 'off';

import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { chat } from './chat/chat';
import { venueWordsDeep } from '../../lib/venue-words';
import { loadConfig, resetConfigForTests } from './config';
import { openStore } from './tools/store';

// The config is read lazily, but make sure it is built from the pinned values above, whatever imported first.
resetConfigForTests(loadConfig(process.env));

// The live snapshot reads the agent's store (24 h move totals, open puts). Without an open store every live read fails
// with "store not opened" and the chat falls back to the sample portfolio. Use a private in-memory store: the chat must
// never write into the tick loop's real log (it holds the daily caps and in-flight locks), so its 24 h totals read as 0.
openStore(':memory:');

// Chat API for the app (the app's /api/agent/chat route calls this with the signed-in user's wallet; the browser never talks to it).
// Separate from the tick loop (npm start), which watches the accounts every 30 s, posts proposals and runs what you approve.
//   npm run chat   (binds 127.0.0.1:AGENT_CHAT_PORT, default 3200; needs  Authorization: Bearer $AGENT_API_TOKEN)
const PORT = Number(process.env.AGENT_CHAT_PORT ?? 3200);
const HOST = process.env.AGENT_CHAT_HOST ?? '127.0.0.1';
const TOKEN = process.env.AGENT_API_TOKEN ?? '';
const MAX_BODY = 128 * 1024;
const RUN_TIMEOUT_MS = 170_000;

const Req = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/), network: z.enum(['mainnet', 'testnet']), signedIn: z.boolean().default(false),
  message: z.string().min(1).max(1200),
  history: z.array(z.object({ role: z.enum(['user', 'agent']), text: z.string().max(50_000).transform((t) => t.slice(0, 1600)) })).max(50).transform((h) => h.slice(-20)).default([]),
  recorded: z.object({
    actions: z.array(z.object({ id: z.number(), status: z.string(), title: z.string().max(300), why: z.string().max(1500), created_at: z.number(), result_message: z.string().nullable() })).max(10).default([]),
    events: z.array(z.object({ kind: z.string().max(30), status: z.string().nullable().optional(), message: z.string().max(600), created_at: z.number().nullable().optional() })).max(20).default([]),
  }).default({}),
});

function authed(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? ''; if (!TOKEN || !h.startsWith('Bearer ')) return false;
  const a = Buffer.from(h.slice(7)); const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  let n = 0; const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
});

export const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, role: 'chat', dryRun: true, model: !!process.env.OPENROUTER_API_KEY });
    if (!authed(req)) return send(401, { error: 'unauthorized' });
    if (req.method === 'POST' && url.pathname === '/chat') {
      let body: unknown; try { body = JSON.parse(await readBody(req)); } catch { return send(400, { error: 'body must be JSON' }); }
      const r = Req.parse(body);
      // What the user reads never names a venue (Aster = perps, Derive = options); the agent itself keeps the names.
      return send(200, venueWordsDeep(await Promise.race([chat(r), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('the agent took too long')), RUN_TIMEOUT_MS))])));
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof ZodError) return send(400, { error: 'invalid input', issues: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return send(400, { error: e instanceof Error ? e.message : String(e) });
  }
});

if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  if (!TOKEN) { console.error('AGENT_API_TOKEN is not set: refusing to start without auth.'); process.exit(1); }
  server.listen(PORT, HOST, () => console.log(`agent chat listening on http://${HOST}:${PORT} (dry run only, model ${process.env.OPENROUTER_API_KEY ? 'on' : 'not configured'})`));
}
