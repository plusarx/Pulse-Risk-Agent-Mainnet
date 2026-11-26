import { Annotation } from '@langchain/langgraph';
import type { Candidate, RejectedCandidate, Snapshot, StepResult } from '../types';
import type { AnalystOut, DeciderOut, ReviewerOut } from '../llm/schemas';
import type { StatePatch } from '../tools/planner';
import type { NewsView } from '../news';
import type { RiskView } from '../risk/plan';

export type Outcome = 'idle' | 'error' | 'skipped' | 'vetoed' | 'awaiting' | 'simulated' | 'done' | 'failed';

// The state flowing through the graph. Each node returns only the fields it changes.
export const AgentState = Annotation.Root({
  snapshot: Annotation<Snapshot>(),
  candidates: Annotation<Candidate[]>({ reducer: (_a, b) => b, default: () => [] }),
  rejected: Annotation<RejectedCandidate[]>({ reducer: (_a, b) => b, default: () => [] }),
  statePatches: Annotation<StatePatch[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** News read this tick (only when news-driven hedging is on). */
  news: Annotation<NewsView[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** When the news was last read (for the status line). */
  newsAt: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  /** Exposure, VaR and the solved hedge for the whole portfolio, computed in `plan`. */
  risk: Annotation<RiskView | null>({ reducer: (_a, b) => b, default: () => null }),
  analysis: Annotation<AnalystOut | null>({ reducer: (_a, b) => b, default: () => null }),
  decision: Annotation<DeciderOut | null>({ reducer: (_a, b) => b, default: () => null }),
  review: Annotation<ReviewerOut | null>({ reducer: (_a, b) => b, default: () => null }),
  chosen: Annotation<Candidate | null>({ reducer: (_a, b) => b, default: () => null }),
  steps: Annotation<StepResult[]>({ reducer: (_a, b) => b, default: () => [] }),
  outcome: Annotation<Outcome>({ reducer: (_a, b) => b, default: () => 'idle' }),
  /** Why nothing ran (skip / veto / error / guard refusal). */
  note: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** Technical text behind a plain note (an error from the app, for example). Shown under Details, never as the message. */
  detail: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  message: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
});
export type AgentStateT = typeof AgentState.State;
