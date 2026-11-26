import { json, sessionWallet } from '@/lib/server/auth';
export async function GET() { return json({ address: await sessionWallet() }); }
