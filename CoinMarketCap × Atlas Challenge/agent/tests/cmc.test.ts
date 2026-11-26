import { describe, expect, it } from 'vitest';
import { callCmc, parseMcpReply } from '../src/tools/cmc';

const sse = (o: unknown) => `event:message\ndata:${JSON.stringify(o)}\n\n`;
const reply = (text: string, isError = false) => sse({ jsonrpc: '2.0', id: 1, result: { isError, content: [{ type: 'text', text }] } });

describe('CoinMarketCap MCP tool', () => {
  it('reads text out of an SSE reply and out of plain JSON', () => {
    expect(parseMcpReply(reply('NVDA earnings 2026-12-02'))).toEqual({ ok: true, text: 'NVDA earnings 2026-12-02' });
    expect(parseMcpReply(JSON.stringify({ result: { content: [{ type: 'text', text: 'x' }] } }))).toEqual({ ok: true, text: 'x' });
  });
  it('turns errors, garbage and empty replies into a reason, never an exception', () => {
    expect(parseMcpReply(reply('error: Token not found', true))).toEqual({ ok: false, reason: 'CoinMarketCap: error: Token not found' });
    expect(parseMcpReply('not json')).toMatchObject({ ok: false });
    expect(parseMcpReply(reply(''))).toMatchObject({ ok: false });
  });
  it('caps a long reply', () => {
    const r = parseMcpReply(reply('a'.repeat(10_000))); expect(r.ok && r.text.length).toBeLessThan(3_600);
  });
  it('without a key it says "not set up" and makes no request', async () => {
    let called = false;
    const r = await callCmc('market_overview', {}, { key: '', fetch: (async () => { called = true; return new Response(''); }) as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false }); expect(called).toBe(false);
  });
  it('sends only the allowlisted MCP tool, with the key header, and rejects a bad ticker before any call', async () => {
    let seen: { url: string; headers: Record<string, string>; body: { params: { name: string; arguments: unknown } } } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }; return new Response(reply('ok')); }) as unknown as typeof fetch;
    expect(await callCmc('stock_events', { symbol: 'nvda' }, { key: 'k', fetch: f })).toEqual({ ok: true, text: 'ok' });
    expect(seen!.url).toBe('https://mcp.coinmarketcap.com/mcp'); expect(seen!.headers['X-CMC-MCP-API-KEY']).toBe('k');
    expect(seen!.body.params).toEqual({ name: 'us_equity_upcoming_event_calendar', arguments: { symbol: 'NVDA' } });
    seen = null;
    expect(await callCmc('stock_events', { symbol: 'NVDA; drop' }, { key: 'k', fetch: f })).toMatchObject({ ok: false }); expect(seen).toBeNull();
  });
  it('maps a rejected key and an outage to plain reasons', async () => {
    expect(await callCmc('market_overview', {}, { key: 'k', fetch: (async () => new Response('', { status: 401 })) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'CoinMarketCap rejected the key' });
    expect(await callCmc('market_overview', {}, { key: 'k', fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'CoinMarketCap could not be reached' });
  });
});
