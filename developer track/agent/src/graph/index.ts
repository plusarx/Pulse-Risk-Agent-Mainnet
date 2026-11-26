import { END, START, StateGraph } from '@langchain/langgraph';
import { analyst, confirm, decider, executeNode, guard, news, plan, report, reviewer, validate } from './nodes';
import { AgentState, type AgentStateT } from './state';

// validate → read_news → plan → analyst → decider → reviewer → confirm → guard → execute → report
// confirm: in confirmation mode it asks the user and ends the run ('awaiting'); in autonomous mode it passes through.
// Any node can short-circuit to `report` by setting `outcome` (error / skipped / vetoed).
// No candidates → the run ends quietly with no LLM call.

const stopped = (s: AgentStateT) => s.outcome !== 'idle';

export function buildGraph() {
  return new StateGraph(AgentState)
    .addNode('validate', validate)
    .addNode('read_news', news)
    .addNode('plan', plan)
    .addNode('analyst', analyst)
    .addNode('decider', decider)
    .addNode('reviewer', reviewer)
    .addNode('confirm', confirm)
    .addNode('guard', guard)
    .addNode('execute', executeNode)
    .addNode('report', report)
    .addEdge(START, 'validate')
    .addConditionalEdges('validate', (s) => (stopped(s) ? 'report' : 'read_news'), ['report', 'read_news'])
    .addEdge('read_news', 'plan')
    .addConditionalEdges('plan', (s) => (s.candidates.length ? 'analyst' : END), ['analyst', END])
    .addConditionalEdges('analyst', (s) => (stopped(s) ? 'report' : 'decider'), ['report', 'decider'])
    .addConditionalEdges('decider', (s) => (stopped(s) ? 'report' : 'reviewer'), ['report', 'reviewer'])
    .addConditionalEdges('reviewer', (s) => (stopped(s) ? 'report' : 'confirm'), ['report', 'confirm'])
    .addConditionalEdges('confirm', (s) => (stopped(s) ? 'report' : 'guard'), ['report', 'guard'])
    .addConditionalEdges('guard', (s) => (stopped(s) ? 'report' : 'execute'), ['report', 'execute'])
    .addEdge('execute', 'report')
    .addEdge('report', END)
    .compile();
}

export type AgentGraph = ReturnType<typeof buildGraph>;
