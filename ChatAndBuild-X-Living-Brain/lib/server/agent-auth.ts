import 'server-only';
import { isAgent, json } from './auth';

export async function withAgent(fn: () => Promise<Response>): Promise<Response> {
  if (!(await isAgent())) return json({ error: 'agent token required' }, 401);
  try { return await fn(); } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
}
