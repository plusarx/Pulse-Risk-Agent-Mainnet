import type { HeadlineView } from './fetch';

// News text is untrusted data. Before anything reads or shows it:
//  1. a headline that looks like an instruction to the agent is REMOVED (never scored, never shown) and its source is quarantined;
//  2. everything else is cleaned (addresses and links stripped, length capped) so a copied headline can never carry an attack.
// None of this changes a position: news stays advisory.

const INJECTION = [
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(rules?|instructions?|prompts?|limits?|polic(y|ies))\b/i,
  /\b(send|transfer|withdraw|wire|move)\b.{0,40}\b(usdc|usdt|funds|tokens?|eth|bnb|crypto|all)\b.{0,40}\b(to|into)\b/i,
  /\bsystem prompt\b|\byou are now\b|\bnew instructions?\b|\bas an ai\b/i,
  /0x[a-fA-F0-9]{12,}/,
  /\bsystem\s*:/i,
  /\b(set|raise|change|increase|lower|disable)\b.{0,30}\b(leverage|hedge ratio|max(imum)?|limits?)\b/i,
];
export const looksLikeInjection = (t: string): boolean => INJECTION.some((re) => re.test(t));

/** Strip wallet addresses and links, collapse whitespace, cap the length. */
export const sanitizeHeadline = (t: string, max = 160): string =>
  t.replace(/0x[a-fA-F0-9]{6,}/g, '[address removed]').replace(/https?:\/\/\S+/gi, '[link removed]').replace(/\s+/g, ' ').trim().slice(0, max);

const TRUSTED = /reuters|bloomberg|wall street journal|wsj|financial times|\bft\b|associated press|\bap\b|cnbc|yahoo finance|marketwatch|barron|investor'?s business daily|the economist|sec\.gov/i;
export const isTrustedSource = (source: string) => TRUSTED.test(source);

/** A market rumour (a halt, a collapse, a call to sell) is NEWS, not an instruction to the agent: it is an advisory flag marked unverified. */
const RUMOUR = /\b(halt(ed)?|bankrupt(cy)?|fraud|collaps\w+|crash(es|ed)?|sell\s+(everything|all)|dump\s+(everything|all)|liquidat\w+|delist\w*|investigat\w+)\b/i;
export const looksLikeRumour = (t: string): boolean => RUMOUR.test(t);

export interface Suspect { source: string; reason: string; /** How many times it arrived: every copy is an attempt. */ count: number }
const quarantined = new Map<string, number>();
export const isQuarantined = (source: string) => quarantined.has(source.toLowerCase());
export const quarantinedSources = () => [...quarantined.keys()];
export const clearQuarantine = () => quarantined.clear();

/** Split headlines into clean ones (sanitised) and suspects. A suspect's source is quarantined: its later items are dropped too. */
export function screenHeadlines(hs: HeadlineView[]): { clean: HeadlineView[]; suspects: Suspect[]; rumours: HeadlineView[] } {
  const clean: HeadlineView[] = []; const suspects: Suspect[] = []; const rumours: HeadlineView[] = [];
  const quarantinedBefore = new Set(quarantined.keys());      // a source quarantined in THIS batch still has its other items counted
  for (const h of hs) {
    if (quarantinedBefore.has(h.source.toLowerCase())) continue;
    if (looksLikeInjection(h.title)) {
      quarantined.set(h.source.toLowerCase(), Date.now());
      suspects.push({ source: h.source, reason: 'the text gives the agent instructions (settings, transfers or an address), which news never does', count: Math.max(1, h.repeats ?? 1) });
      continue;
    }
    const view = { ...h, title: sanitizeHeadline(h.title), trusted: isTrustedSource(h.source) };
    if (!view.trusted && looksLikeRumour(h.title)) { rumours.push(view); continue; }
    clean.push(view);
  }
  return { clean, suspects, rumours };
}

// Calendar vs news. If the calendar says an earnings event is still ahead but a recent headline reports the results as
// already out, one of the two is wrong. The agent cannot tell which, so it raises an alert and asks first (never autonomous).
const RESULTS_OUT = /\b(beats?|beat|misses?|missed|tops?|topped|reported|posts?|posted|reports?\s+(?:record|strong|weak))\b.{0,50}\b(earnings|results|estimates|revenue|quarter|guidance)\b|\b(raises?|raised|cuts?|lowers?|lowered)\b.{0,20}\bguidance\b/i;
export function calendarNewsConflicts(events: { ticker: string; at: string; kind: string }[], news: { ticker: string; headlines: HeadlineView[] }[], now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    if (!/earn|results|report/i.test(e.kind) || Date.parse(e.at) <= now) continue;
    const n = news.find((x) => x.ticker === e.ticker);
    const hit = n?.headlines.find((h) => h.ageHours <= 48 && RESULTS_OUT.test(h.title));
    if (hit) out[e.ticker] = `calendar says ${e.ticker} ${e.kind} is ${((Date.parse(e.at) - now) / 3_600_000).toFixed(0)}h away, but a headline from ${hit.source} (${hit.ageHours}h ago) reports results as already out. Either the date or the news is wrong, so this needs your check`;
  }
  return out;
}
