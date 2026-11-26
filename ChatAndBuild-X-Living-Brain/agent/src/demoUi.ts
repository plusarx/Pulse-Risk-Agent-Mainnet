import { config } from './config';
import { fixtureSnapshot } from './fixtures';
import { buildGraph } from './graph';
import { buildStatus } from './status';
import * as app from './tools/appApi';
import { openStore } from './tools/store';

// Pushes ONE demo run into the app's UI for a real wallet, with no venue connection needed.
// Usage: npm run demo:ui -- 0xYourWalletAddress
// It runs the real graph (and the real LLM if LLM_MODE=on) on a made-up perps account at 82% utilization,
// then posts the events/rule-state to the running app. Always a dry run: nothing moves anywhere.
const wallet = process.argv[2];
if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) { console.error('Usage: npm run demo:ui -- 0xYourWalletAddress'); process.exit(1); }
process.env.DRY_RUN = 'true'; process.env.POST_EVENTS = 'true';
openStore(':memory:');
const c = config();
console.log(`demo:ui · wallet=${wallet} · network=${c.AGENT_NETWORK} · llm=${c.LLM_MODE} · app=${c.APP_API_URL}`);
const snapshot = fixtureSnapshot({ wallet, network: c.AGENT_NETWORK });
const out = await buildGraph().invoke({ snapshot });
// Post the status too, so the status panel does not say "has not reported yet" while the activity feed shows a run.
await app.postStatus(buildStatus(snapshot, { news: out.news, newsAt: out.newsAt })).catch((e) => console.warn(`status post failed: ${e instanceof Error ? e.message : String(e)}`));
console.log(`outcome=${out.outcome}\n${out.message}`);
