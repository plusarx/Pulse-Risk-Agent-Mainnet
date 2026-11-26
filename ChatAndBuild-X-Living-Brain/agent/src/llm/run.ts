import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { z } from 'zod';
import { config } from '../config';
import { systemPrompt, type LlmNode } from './prompts';

// One OpenRouter-backed model per node. Models, fallbacks, temperature and timeout all come from .env.
// OpenRouter is OpenAI-compatible, so ChatOpenAI is pointed at its base URL.

const modelFor = (node: LlmNode): string => {
  const c = config();
  return { risk_analyst: c.LLM_MODEL_RISK_ANALYST, news_analyst: c.LLM_MODEL_NEWS_ANALYST, analyst: c.LLM_MODEL_ANALYST, decider: c.LLM_MODEL_DECIDER, reviewer: c.LLM_MODEL_REVIEWER, reporter: c.LLM_MODEL_REPORTER }[node];
};

export type LlmRunner = <T>(node: LlmNode, schema: z.ZodType<T>, input: unknown) => Promise<T>;

const real: LlmRunner = async (node, schema, input) => {
  const c = config();
  if (!c.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');
  const llm = new ChatOpenAI({
    model: modelFor(node), apiKey: c.OPENROUTER_API_KEY, temperature: c.LLM_TEMPERATURE, timeout: c.LLM_TIMEOUT_MS, maxRetries: c.LLM_MAX_RETRIES,
    configuration: { baseURL: c.OPENROUTER_BASE_URL },
    // OpenRouter-native fallback list, tried in order if the primary model errors.
    modelKwargs: c.LLM_FALLBACK_MODELS.length ? { models: [modelFor(node), ...c.LLM_FALLBACK_MODELS], route: 'fallback' } : undefined,
  });
  const structured = llm.withStructuredOutput(schema, { name: node, method: 'functionCalling' });
  return (await structured.invoke([new SystemMessage(systemPrompt(node)), new HumanMessage(JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))])) as never;
};

let runner: LlmRunner = real;
/** Tests inject a fake runner so no network is touched. Call with no argument to restore the real one. */
export const setLlmRunner = (r?: LlmRunner) => { runner = r ?? real; };
export const runLlm: LlmRunner = (node, schema, input) => runner(node, schema, input);
