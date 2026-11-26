import { clearSession, json } from '@/lib/server/auth';
export async function POST() { await clearSession(); return json({ ok: true }); }
