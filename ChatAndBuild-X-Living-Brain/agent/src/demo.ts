import { config } from './config';
import { fixtureSnapshot } from './fixtures';
import { buildGraph } from './graph';
import { openStore } from './tools/store';

// Runs the whole graph on a made-up snapshot: no app, no chain, no venue. Uses the LLM_MODE and OpenRouter
// settings from .env (set LLM_MODE=off to see it with no LLM at all). Always a dry run.
openStore(':memory:');
process.env.POST_EVENTS = 'false';
process.env.DRY_RUN = 'true';
const c = config();
console.log(`demo · llm=${c.LLM_MODE} · decider model=${c.LLM_MODEL_DECIDER}`);
const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
console.log(JSON.stringify({ outcome: out.outcome, note: out.note, chosen: out.chosen?.id, steps: out.steps, message: out.message, analysis: out.analysis, decision: out.decision, review: out.review }, null, 2));
