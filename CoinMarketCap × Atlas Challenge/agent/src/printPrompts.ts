import { LLM_NODES, systemPrompt } from './llm/prompts';

// Prints the exact system prompt each LLM node sends (shared rules + the node's own file).
for (const n of LLM_NODES) console.log(`\n${'='.repeat(70)}\nNODE: ${n}\n${'='.repeat(70)}\n${systemPrompt(n)}\n`);
