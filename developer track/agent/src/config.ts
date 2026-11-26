import { z } from 'zod';

const bool = (d: boolean) => z.string().optional().transform((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const csv = z.string().optional().transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const Env = z.object({
  APP_API_URL: z.string().url().default('http://localhost:3100'),
  AGENT_API_TOKEN: z.string().default(''),
  AGENT_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  TICK_INTERVAL_SEC: z.coerce.number().int().min(5).default(30),

  DRY_RUN: bool(true),
  ALLOW_LIVE: z.string().default('no'),
  POST_EVENTS: bool(true),

  LLM_MODE: z.enum(['on', 'off']).default('on'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_MODEL_ANALYST: z.string().default('anthropic/claude-sonnet-4.5'),
  LLM_MODEL_DECIDER: z.string().default('anthropic/claude-sonnet-4.5'),
  LLM_MODEL_REVIEWER: z.string().default('anthropic/claude-sonnet-4.5'),
  LLM_MODEL_REPORTER: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_RISK_ANALYST: z.string().default('anthropic/claude-sonnet-4.5'),
  LLM_MODEL_NEWS_ANALYST: z.string().default('anthropic/claude-sonnet-4.5'),
  LLM_FALLBACK_MODELS: csv,
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  /** The chat writes long, multi-scenario answers: its model calls get more time than the trading decisions. */
  CHAT_LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(85_000).default(75_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

  // Risk-analyst proposals (rules fitted to volatility, latency and leverage). All tunable.
  PROPOSE_INTERVAL_SEC: z.coerce.number().int().min(30).default(300),
  PROPOSE_MAX_UTIL: z.coerce.number().min(0.5).max(0.99).default(0.9),
  PROPOSE_K_SIGMA: z.coerce.number().min(1).max(6).default(3),
  PROPOSE_VOL_STRESS: z.coerce.number().min(1).max(5).default(2),
  PROPOSE_MIN_TRIGGER: z.coerce.number().min(0.2).max(0.8).default(0.4),
  PROPOSE_MAX_TRIGGER: z.coerce.number().min(0.4).max(0.95).default(0.8),
  DEFAULT_LATENCY_SEC: z.coerce.number().min(1).default(60),
  AGENT_BSC_PRIVATE_KEY: z.string().default(''),
  BSC_RPC_URL: z.string().url().default('https://bsc-dataseed.bnbchain.org'),
  ETH_RPC_URL: z.string().default(''),
  RELAY_API_KEY: z.string().default(''),
  /** Atlas oracle key for the price-integrity layer. Optional: without it Atlas is simply not read. */
  ATLAS_API_KEY: z.string().default(''),
  /** CoinMarketCap MCP key (free Basic tier). Optional: without it the chat agent says CMC data is not set up. */
  CMC_API_KEY: z.string().default(''),

  // News-driven hedging (free RSS sources, no API key). Headlines are cached so the 30 s loop does not refetch.
  NEWS_TTL_SEC: z.coerce.number().int().min(30).default(600),
  NEWS_MAX_AGE_HOURS: z.coerce.number().min(1).default(48),
  /** Ignore news weaker than this (score x confidence, 0..1): the hedge stays at the user's base ratio. */
  NEWS_MIN_SIGNAL: z.coerce.number().min(0).max(1).default(0.3),
  /** A confirmation request is re-asked at most once per this many seconds (so changing numbers do not spam). */
  ACTION_BUCKET_SEC: z.coerce.number().int().min(60).default(600),

  // Anomaly stop: this many intents, or this many refusals, inside the window pauses the agent for PAUSE_MIN minutes.
  ANOMALY_MAX_INTENTS: z.coerce.number().int().min(2).default(12),
  ANOMALY_MAX_REFUSALS: z.coerce.number().int().min(2).default(6),
  ANOMALY_WINDOW_SEC: z.coerce.number().int().min(60).default(600),
  PAUSE_MIN: z.coerce.number().int().min(1).default(30),

  /** Seconds a margin move BNB -> Derive takes (BNB -> Ethereum USDC -> Derive deposit). Measured values replace it later. */
  DERIVE_ETA_SEC: z.coerce.number().min(1).default(1800),

  AGENT_DB_PATH: z.string().default('./data/agent.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof Env> & { live: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = Env.parse(env);
  // Live execution needs both switches. Anything else is a dry run.
  const live = !c.DRY_RUN && c.ALLOW_LIVE === 'yes-i-understand';
  return { ...c, live };
}

let cached: Config | null = null;
export const config = (): Config => (cached ??= loadConfig());
export const resetConfigForTests = (c?: Config) => { cached = c ?? null; };
