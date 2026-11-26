import { createHash } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ProposalIn } from '../../../lib/agent-proposal';
import { config } from '../config';
import { log } from '../log';
import { RiskAnalystOut } from '../llm/schemas';
import { runLlm } from '../llm/run';
import { draftText, fitRule, type Fit, type FitInputs } from '../proposal/compute';
import { fitParams, type AccountView } from '../proposal/propose';
import * as app from '../tools/appApi';
import type { Network } from '../types';

// Proposal graph (the spec's "risk analyst agent"):
//   validate_inputs -> fit_rule (code) -> explain (LLM) -> submit (to the app; a human approves there)
// INPUT = positions, collateral by location, realised 1h volatility, measured latency (the spec's input contract).
// Code sets every number. The LLM only writes the explanation. Nothing is armed until a human approves in the UI.

export interface ProposalInput { wallet: string; network: Network; account: AccountView; market: FitInputs }

const State = Annotation.Root({
  input: Annotation<ProposalInput>(),
  fit: Annotation<Fit | null>({ reducer: (_a, b) => b, default: () => null }),
  text: Annotation<{ structural_risk: string; reasoning: string } | null>({ reducer: (_a, b) => b, default: () => null }),
  proposal: Annotation<ProposalIn | null>({ reducer: (_a, b) => b, default: () => null }),
  status: Annotation<'ok' | 'error' | 'submitted' | 'dry'>({ reducer: (_a, b) => b, default: () => 'ok' }),
  note: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
});
type S = typeof State.State;

const finite = (...n: number[]) => n.every((x) => Number.isFinite(x));

/** Fail closed: no guessed or missing market data. */
const validateInputs = async (s: S): Promise<Partial<S>> => {
  const m = s.input.market;
  if (!finite(m.vol1h, m.latencySec, m.leverage, m.utilNow, m.equityUsd, m.usedUsd, m.bnbStablesUsd, m.bstocksAfterHaircutUsd)) return { status: 'error', note: 'market input missing or not a number' };
  if (m.vol1h <= 0 || m.equityUsd <= 0 || m.usedUsd <= 0 || m.leverage <= 0) return { status: 'error', note: 'volatility, equity, margin used and leverage must all be positive' };
  if (m.utilNow > 1) return { status: 'error', note: 'utilization above 100% looks wrong' };
  return {};
};

const fitNode = async (s: S): Promise<Partial<S>> => ({ fit: fitRule(s.input.market, fitParams()) });

const explainNode = async (s: S): Promise<Partial<S>> => {
  const fit = s.fit!; const { account, market } = s.input;
  let text = draftText(fit); let note = 'plain draft (LLM off)';
  if (config().LLM_MODE === 'on') {
    try {
      text = await runLlm('risk_analyst', RiskAnalystOut, { account: { ...account, leverage: market.leverage, utilizationNow: market.utilNow }, fit: fit.rule, metrics: fit.metrics, facts: fit.facts });
      note = 'explained by LLM';
    } catch (e) { log.warn(`risk analyst LLM unavailable: ${e instanceof Error ? e.message : String(e)}`); note = 'plain draft (LLM failed)'; }
  }
  const { wallet, network } = s.input;
  const key = createHash('sha256').update(`${wallet.toLowerCase()}|${network}|${account.venue}|${account.accountRef}|${JSON.stringify(fit.rule)}`).digest('hex').slice(0, 24);
  const proposal = ProposalIn.parse({ wallet, network, venue: account.venue, accountRef: account.accountRef, structural_risk: text.structural_risk, proposed_rule: fit.rule, reasoning: text.reasoning, metrics: fit.metrics, idempotencyKey: `prop-${key}` });
  return { text, proposal, note };
};

let submitFn: typeof app.postProposal | null = app.postProposal;
/** Pass null for a dry graph run that never calls the app. */
export const setProposalSubmitter = (f: typeof app.postProposal | null) => { submitFn = f; };

const submitNode = async (s: S): Promise<Partial<S>> => {
  if (!submitFn) return { status: 'dry' };
  const r = await submitFn(s.proposal!);
  return { status: 'submitted', note: r.duplicate ? 'same proposal already submitted' : `proposal #${r.id} submitted, waiting for human approval` };
};

export function buildProposalGraph() {
  return new StateGraph(State)
    .addNode('validate_inputs', validateInputs).addNode('fit_rule', fitNode).addNode('explain', explainNode).addNode('submit', submitNode)
    .addEdge(START, 'validate_inputs')
    .addConditionalEdges('validate_inputs', (s) => (s.status === 'error' ? END : 'fit_rule'), ['fit_rule', END])
    .addEdge('fit_rule', 'explain').addEdge('explain', 'submit').addEdge('submit', END)
    .compile();
}
