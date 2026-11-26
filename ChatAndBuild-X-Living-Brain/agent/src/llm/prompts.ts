import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LLM_NODES = ['risk_analyst', 'news_analyst', 'analyst', 'decider', 'reviewer', 'reporter'] as const;
export type LlmNode = (typeof LLM_NODES)[number];

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8').trim();
/** A prompt file by name, for callers that build their own system prompt (the chat agent). Read on every call, so edits apply without a restart. */
export const readPrompt = (file: string): string => read(file);

/** Full system prompt of one node: shared rules + the node's own file. Edit the .md files to change behavior. */
export const systemPrompt = (node: LlmNode): string => `${read('common.md')}\n\n---\n\n${read(`${node}.md`)}`;
