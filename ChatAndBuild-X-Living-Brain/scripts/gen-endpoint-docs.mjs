// Generates the MAINNET endpoint reference (docs/reference/*.md) from each venue's own machine-readable spec,
// so the docs list every endpoint, parameter and response field rather than a hand-picked subset.
//
//   node scripts/gen-endpoint-docs.mjs
//
// Sources (fetched live):
//   Derive v3   https://docs.derive.xyz/openapi.json + /subscriptions.asyncapi.json
//   Lighter     https://raw.githubusercontent.com/elliottech/lighter-python/main/openapi.json (official SDK spec)
//               https://docs.lighter.xyz/api/websocket.md (WebSocket channels)
//   Relay       https://api.relay.link/documentation/json
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'docs', 'reference');
const TODAY = new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

// ── schema helpers ────────────────────────────────────────────────────────────
function resolver(spec) {
  const get = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[decodeURIComponent(k)], spec);
  const deref = (s, seen = new Set()) => {
    if (!s || typeof s !== 'object') return s;
    if (s.$ref) { if (seen.has(s.$ref)) return { type: 'object', description: '(recursive)' }; seen.add(s.$ref); return deref(get(s.$ref), seen); }
    const parts = s.allOf ?? null;
    if (parts) {
      const merged = { type: 'object', properties: {}, required: [], description: s.description };
      for (const p of parts) { const r = deref(p, seen); Object.assign(merged.properties, r?.properties ?? {}); merged.required.push(...(r?.required ?? [])); merged.description ??= r?.description; }
      return merged;
    }
    return s;
  };
  return deref;
}

const clean = (t, max = 260) => {
  if (!t) return '';
  const one = String(t).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

function typeOf(s, deref) {
  s = deref(s);
  if (!s) return '';
  const alt = s.oneOf ?? s.anyOf;
  if (alt) return alt.map((x) => typeOf(x, deref)).filter((x) => x && x !== 'null').join(' \\| ') || 'any';
  if (s.enum) return `enum: ${s.enum.slice(0, 12).map((e) => `\`${e}\``).join(', ')}${s.enum.length > 12 ? ', …' : ''}`;
  if (s.type === 'array') return `${typeOf(s.items, deref) || 'any'}[]`;
  if (Array.isArray(s.type)) return s.type.filter((x) => x !== 'null').join(' \\| ');
  return s.format ? `${s.type ?? 'any'} (${s.format})` : (s.type ?? (s.properties ? 'object' : 'any'));
}

/** Flatten an object schema into rows of dotted field names, up to `depth` levels, capped at `limit` rows. */
function fields(schema, deref, { depth = 2, limit = 80, prefix = '' } = {}) {
  const rows = [];
  const walk = (s, pre, d) => {
    s = deref(s);
    if (!s) return;
    if (s.type === 'array' && s.items) { walk(s.items, `${pre}[]`, d); return; }
    const alt = s.oneOf ?? s.anyOf;
    if (alt && !s.properties) { const obj = alt.map((x) => deref(x)).find((x) => x?.properties); if (obj) walk(obj, pre, d); return; }
    const props = s.properties ?? {};
    const req = new Set(s.required ?? []);
    for (const [k, v] of Object.entries(props)) {
      if (rows.length >= limit) return;
      const r = deref(v);
      const name = pre ? `${pre}.${k}` : k;
      rows.push({ name, type: typeOf(r, deref), required: req.has(k), desc: clean(r?.description ?? v.description) });
      const inner = r?.type === 'array' ? deref(r.items) : r;
      if (d + 1 < depth && inner && (inner.properties || inner.oneOf || inner.anyOf)) walk(r, name, d + 1);
    }
  };
  walk(schema, prefix, 0);
  return rows;
}

function table(rows, withReq = true) {
  if (!rows.length) return '_none_\n';
  const head = withReq ? '| Field | Type | Req. | Description |\n| --- | --- | --- | --- |' : '| Field | Type | Description |\n| --- | --- | --- |';
  return `${head}\n${rows.map((r) => (withReq ? `| \`${r.name}\` | ${r.type} | ${r.required ? 'yes' : ''} | ${r.desc} |` : `| \`${r.name}\` | ${r.type} | ${r.desc} |`)).join('\n')}\n`;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const anchor = (id) => `<a id="${id}"></a>`;

// ── Derive ────────────────────────────────────────────────────────────────────
async function derive() {
  const spec = await getJson('https://docs.derive.xyz/openapi.json');
  const ws = await getJson('https://docs.derive.xyz/subscriptions.asyncapi.json').catch(() => null);
  const deref = resolver(spec);
  const groups = new Map();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [, op] of Object.entries(ops)) {
      const tag = op.tags?.[0] ?? 'Other';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ method: p.replace(/^\//, ''), op });
    }
  }
  const tags = [...groups.keys()].sort((a, b) => (a === 'Market Data' ? -1 : b === 'Market Data' ? 1 : a.localeCompare(b)));
  let md = `# Derive v3 — full API reference (mainnet)\n\nGenerated ${TODAY} from Derive's own OpenAPI spec (${spec.info?.title} ${spec.info?.version ?? ''}, ${Object.keys(spec.paths).length} methods) by \`scripts/gen-endpoint-docs.mjs\`. **Mainnet only.**\n\n`;
  md += `- **REST:** \`POST https://api.derive.xyz/v3/{method}\` with flat JSON params. Errors: \`{error:{code,message,data}}\`.\n- **WebSocket:** \`wss://api.derive.xyz/v3/ws\`, frame \`{id, method, params}\`; \`subscribe\` with \`{channels:[…]}\`.\n- **Private auth:** headers \`X-DeriveWallet\`, \`X-DeriveTimestamp\` (ms), \`X-DeriveSignature\` (= personal_sign of the timestamp by the owner or a session key). WebSocket: \`public/login\`.\n- **Greeks:** in every ticker (\`public/get_ticker\`, \`public/get_tickers\`, \`ticker_slim.*\` channel) under \`option_pricing\`, and per position in \`private/get_positions\` / \`private/get_subaccount\`. See [Greeks & data points](#greeks-and-data-points).\n\n`;
  md += `## Contents\n\n${tags.map((t) => `- [${t}](#${slug(t)}) (${groups.get(t).length})`).join('\n')}\n- [WebSocket channels](#websocket-channels)\n\n`;

  // Greeks & data points quick map (curated pointers; fields themselves are generated below)
  md += `${anchor('greeks-and-data-points')}\n## Greeks & data points — where each lives\n\n| Data point | Method / channel | Field |\n| --- | --- | --- |\n`;
  md += [
    ['Delta, gamma, vega, theta, rho (option)', '`public/get_ticker`, `public/get_tickers` (needs `expiry_date` for options), `ticker_slim.{instrument}.{ms}`', '`option_pricing.d` `g` `v` `t` `r`'],
    ['Mark IV, bid IV, ask IV', 'same', '`option_pricing.i`, `bi`, `ai`'],
    ['Option mark / forward / discount factor', 'same', '`option_pricing.m`, `f`, `df`'],
    ['Mark, index, best bid/ask + sizes', 'same', '`M`, `I`, `b`/`B`, `a`/`A`'],
    ['Funding rate (perp)', 'same; history `public/get_funding_rate_history`', '`f`'],
    ['Price band (order limits)', 'same', '`minp`, `maxp`'],
    ['24h stats, open interest', 'same', '`stats.{c,v,p,oi,h,l,n,pr}`'],
    ['Position greeks', '`private/get_positions`, `private/get_subaccount`', '`delta`, `gamma`, `vega`, `theta`, `liquidation_price`'],
    ['Margin (IM / MM headroom)', '`private/get_subaccount`, `private/get_margin`, `public/get_margin` (simulation)', '`initial_margin`, `maintenance_margin`'],
    ['Collateral balances', '`private/get_subaccount`, `private/get_collaterals`', '`collaterals[]`'],
    ['Candles', '`public/get_tradingview_chart_data`', 'OHLC + volume'],
    ['Index history', '`public/get_index_chart_data`', ''],
    ['Settlement prices', '`public/get_option_settlement_prices`, `private/get_option_settlement_history`', ''],
    ['Deposits / withdrawals', '`private/get_deposit_history`, `private/get_withdrawal_history`, `public/get_pending_deposits`, `private/withdraw`', ''],
    ['Subaccounts', '`public/get_subaccounts`, `private/get_account`, `private/get_all_portfolios`, `private/transfer_spot`', ''],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += '\n\n';

  for (const t of tags) {
    md += `${anchor(slug(t))}\n## ${t}\n\n`;
    for (const { method, op } of groups.get(t).sort((a, b) => a.method.localeCompare(b.method))) {
      const req = op.requestBody?.content?.['application/json']?.schema;
      const res = op.responses?.['200']?.content?.['application/json']?.schema;
      const priv = method.startsWith('private/') || (op.security ?? []).length > 0;
      md += `### \`${method}\`\n\n${clean(op.description, 900)}\n\n`;
      md += `${priv ? '**Auth:** private (X-Derive* headers / WebSocket login)' : '**Auth:** public'}${op['x-rate-limit-class'] ? ` · **Rate class:** \`${op['x-rate-limit-class']}\`` : ''}\n\n`;
      md += `**Params**\n\n${table(fields(req, deref, { depth: 2, limit: 60 }))}\n`;
      md += `**Result**\n\n${table(fields(res, deref, { depth: 3, limit: 90 }), false)}\n`;
    }
  }

  md += `${anchor('websocket-channels')}\n## WebSocket channels\n\n`;
  if (ws?.channels) {
    const wsDeref = resolver(ws);
    for (const [ch, def] of Object.entries(ws.channels)) {
      const msg = def.subscribe?.message ?? def.publish?.message ?? Object.values(def.messages ?? {})[0];
      // Prefer the notification message (the data pushed to you) over subscribe/unsubscribe requests.
      const msgs = Object.entries(def.messages ?? {});
      const note = msgs.find(([k]) => /notification/i.test(k))?.[1] ?? msgs.find(([k]) => !/subscribe/i.test(k))?.[1] ?? msg;
      const payload = wsDeref(note)?.payload;
      const name = /Channel name: `([^`]+)`/.exec(def.description ?? '')?.[1] ?? ch;
      md += `### \`${name}\`\n\n${clean((def.description ?? '').replace(/Channel name: `[^`]+`\.?\s*/, ''), 700)}\n\n${table(fields(payload, wsDeref, { depth: 4, limit: 80 }), false)}\n`;
    }
  } else md += '_Could not load the subscriptions spec._\n';
  return md;
}

// ── Lighter ───────────────────────────────────────────────────────────────────
async function lighter() {
  const spec = await getJson('https://raw.githubusercontent.com/elliottech/lighter-python/main/openapi.json');
  const deref = resolver(spec);
  const groups = new Map();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [verb, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'delete'].includes(verb)) continue;
      const tag = op.tags?.[0] ?? 'other';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ path: p, verb: verb.toUpperCase(), op });
    }
  }
  const tags = [...groups.keys()].sort();
  let md = `# Lighter — full API reference (mainnet)\n\nGenerated ${TODAY} from Lighter's official OpenAPI spec (shipped with \`elliottech/lighter-python\`, ${Object.keys(spec.paths).length} paths) by \`scripts/gen-endpoint-docs.mjs\`. **Mainnet only.**\n\n`;
  md += `- **REST base:** \`https://mainnet.zklighter.elliot.ai\` · signing chain id **304** · L1 = Ethereum mainnet.\n- **WebSocket:** \`wss://mainnet.zklighter.elliot.ai/stream\` (see [WebSocket channels](#websocket-channels)).\n- **Errors:** domain errors come back with a \`code\` (e.g. HTTP 400 + \`code 21100\` = account not found; HTTP 200 + \`code != 200\` = tx rejected). Always check \`code\`.\n- **Auth:** private reads take \`auth\` (query) or \`Authorization\` (header) = a token from the signer's \`CreateAuthToken\`; writes go through \`/api/v1/sendTx\` with a signed \`tx_info\` (tx types: 8 ChangePubKey, 9 CreateSubAccount, 12 Transfer, 13 Withdraw, 14 CreateOrder, 15 CancelOrder, 16 CancelAll, 17 ModifyOrder, 20 UpdateLeverage, 29 UpdateMargin, 45 ApproveIntegrator).\n- **Mainnet contracts (Ethereum):** ZkLighter \`0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7\` — \`deposit(address _to, uint16 _assetIndex=3 (USDC), uint8 _routeType=0, uint256 _amount)\`; USDC \`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\`.\n\n`;
  md += `## Data points — where each lives\n\n| Data point | Endpoint |\n| --- | --- |\n`;
  md += [
    ['Accounts of an L1 address (master + sub-accounts)', '`GET /api/v1/accountsByL1Address`, `GET /api/v1/account?by=l1_address`'],
    ['Balances, collateral, available, margin requirement', '`GET /api/v1/account` (`collateral`, `available_balance`, `total_asset_value`, `cross_*_margin_requirement`)'],
    ['Positions, entry, uPnL, liquidation price', '`GET /api/v1/account` → `positions[]`; WS `account_all/{idx}`'],
    ['Live margin usage / leverage', 'WS `user_stats/{idx}`'],
    ['Markets, decimals, margin fractions, mark/index', '`GET /api/v1/orderBooks`, `GET /api/v1/orderBookDetails`'],
    ['Order book', '`GET /api/v1/orderBookOrders`; WS `order_book/{market}`'],
    ['Candles / mark-price candles', '`GET /api/v1/candles`, `GET /api/v1/markPriceCandles`'],
    ['Trades', '`GET /api/v1/recentTrades`, `GET /api/v1/trades`'],
    ['Funding', '`GET /api/v1/fundings`, `GET /api/v1/funding-rates`, `GET /api/v1/positionFunding`'],
    ['PnL history', '`GET /api/v1/pnl`'],
    ['Deposits', 'Ethereum `ZkLighter.deposit`; `GET /api/v1/deposit/history`, `/deposit/latest`, `/deposit/networks`, `POST /api/v1/createIntentAddress`'],
    ['Withdrawals', '`sendTx` type 13 (secure, ~26 min); `POST /api/v1/fastwithdraw` + `/fastwithdraw/info`; `GET /api/v1/withdraw/history`, `/withdrawalDelay`'],
    ['Sub-accounts / transfers', '`sendTx` type 9 (create) / 12 (transfer); `GET /api/v1/transfer/history`, `/transferFeeInfo`'],
    ['API keys, nonce', '`GET /api/v1/apikeys`, `GET /api/v1/nextNonce`'],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += `\n\n## Contents\n\n${tags.map((t) => `- [${t}](#${slug(`l-${t}`)}) (${groups.get(t).length})`).join('\n')}\n- [WebSocket channels](#websocket-channels)\n\n`;
  for (const t of tags) {
    md += `${anchor(slug(`l-${t}`))}\n## ${t}\n\n`;
    for (const { path: p, verb, op } of groups.get(t).sort((a, b) => a.path.localeCompare(b.path))) {
      const params = (op.parameters ?? []).map((x) => deref(x)).map((x) => ({ name: x.name, type: `${typeOf(x.schema, deref)} (${x.in})`, required: !!x.required, desc: clean(x.description) }));
      const body = op.requestBody?.content && Object.values(op.requestBody.content)[0]?.schema;
      const res = op.responses?.['200']?.content && Object.values(op.responses['200'].content)[0]?.schema;
      md += `### \`${verb} ${p}\`\n\n${clean(op.summary ?? '', 300)}${op.description && op.description !== op.summary ? ` — ${clean(op.description, 700)}` : ''}\n\n`;
      md += `**Params**\n\n${table([...params, ...fields(body, deref, { depth: 1, limit: 40 })])}\n`;
      md += `**Response**\n\n${table(fields(res, deref, { depth: 3, limit: 90 }), false)}\n`;
    }
  }
  // WebSocket: Lighter documents channels in prose; keep their page as the source of truth.
  const wsMd = await getText('https://docs.lighter.xyz/api/websocket.md').catch(() => '');
  // Each channel is a "### Title" section under "## Channels"; its subscribe string is the first
  // `"channel": "<name>/…"` example (slash form = what you send; colon form = what comes back).
  const chanPart = wsMd.split(/\n## Channels\b/)[1] ?? '';
  const sections = chanPart.split(/\n### /).slice(1).map((sec) => {
    const title = sec.split('\n')[0].trim();
    const sub = /"channel"\s*:\s*"([a-z_]+\/[^"]*\{[^"]*)"/.exec(sec)?.[1] ?? /"channel"\s*:\s*"([a-z_]+(?:\/[^"]*)?)"/.exec(sec)?.[1] ?? '';
    const desc = sec.split('\n').slice(1).find((l) => l.trim() && !l.startsWith('```') && !l.startsWith('|') && !l.startsWith('#') && !l.trim().startsWith('{') && !l.trim().startsWith('"'))?.trim() ?? '';
    const auth = /auth/i.test(sec.slice(0, 600)) && /requires? (an? )?auth|auth token|"auth"/i.test(sec) ? 'auth' : '';
    return { title, sub, desc: clean(desc, 300), auth };
  }).filter((s) => s.title);
  md += `${anchor('websocket-channels')}\n## WebSocket channels\n\nConnect \`wss://mainnet.zklighter.elliot.ai/stream\`; subscribe \`{"type":"subscribe","channel":"order_book/1"}\` (add \`"auth":"<token>"\` for private channels); replies arrive as \`subscribed/<ch>\` then \`update/<ch>\` with the channel written with colons (\`order_book:1\`). Keep-alive: any frame at least every 2 min (\`{"type":"ping"}\`). Send txs over WS with \`{"type":"jsonapi/sendtx","data":{…}}\`. Field shapes: see the Types section of [docs.lighter.xyz/api/websocket](https://docs.lighter.xyz/api/websocket).\n\n`;
  md += sections.length
    ? `| Channel | Subscribe with | Auth | What it streams |\n| --- | --- | --- | --- |\n${sections.map((s) => `| ${s.title} | ${s.sub ? `\`${s.sub}\`` : ''} | ${s.auth ? 'token' : ''} | ${s.desc} |`).join('\n')}\n`
    : '_Channel list not available._\n';
  return md;
}

// ── Relay ─────────────────────────────────────────────────────────────────────
async function relay() {
  const spec = await getJson('https://api.relay.link/documentation/json');
  const deref = resolver(spec);
  let md = `# Relay — full API reference (mainnet)\n\nGenerated ${TODAY} from Relay's OpenAPI spec (${Object.keys(spec.paths).length} paths) by \`scripts/gen-endpoint-docs.mjs\`. **Mainnet only:** base \`https://api.relay.link\`.\n\n- Used for BNB Chain ↔ Lighter (chain \`3586256\`, currency \`"0"\`, recipient = Lighter account index) and BNB Chain ↔ Ethereum USDC (for Derive). Derive Chain is not supported.\n- Core flow: \`POST /quote/v2\` → execute \`steps[].items[].data\` → poll \`GET /intents/status/v3?requestId=\`.\n\n## Contents\n\n`;
  const entries = Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops).filter(([v]) => ['get', 'post', 'put', 'delete'].includes(v)).map(([v, op]) => ({ p, v: v.toUpperCase(), op })));
  md += entries.map((e) => `- [\`${e.v} ${e.p}\`](#${slug(`r-${e.v}-${e.p}`)})`).join('\n') + '\n\n';
  for (const { p, v, op } of entries) {
    const params = (op.parameters ?? []).map((x) => deref(x)).map((x) => ({ name: x.name, type: `${typeOf(x.schema, deref)} (${x.in})`, required: !!x.required, desc: clean(x.description) }));
    const body = op.requestBody?.content && Object.values(op.requestBody.content)[0]?.schema;
    const res = op.responses?.['200']?.content && Object.values(op.responses['200'].content)[0]?.schema;
    md += `${anchor(slug(`r-${v}-${p}`))}\n### \`${v} ${p}\`\n\n${clean(op.summary ?? op.description ?? '', 600)}${op.deprecated ? ' **(deprecated)**' : ''}\n\n**Params**\n\n${table([...params, ...fields(body, deref, { depth: 2, limit: 50 })])}\n**Response**\n\n${table(fields(res, deref, { depth: 2, limit: 60 }), false)}\n`;
  }
  return md;
}

// ── BNB Chain / bStocks (no single spec: contracts + market-data endpoints, token list from lib/bstocks.ts) ──
async function bnb() {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(process.cwd(), 'lib', 'bstocks.ts'), 'utf8');
  const tokens = [...src.matchAll(/symbol: '(\w+)',\s*underlying: '(\w+)',\s*displayName: '([^']+)',\s*address: '(0x[0-9a-fA-F]{40})'.*?observedLiquidityUsd:\s*([\d_]+)/g)]
    .map((m) => ({ symbol: m[1], underlying: m[2], name: m[3], address: m[4], liq: Number(m[5].replace(/_/g, '')) }));
  let md = `# BNB Chain, bStocks & mainnet index\n\nGenerated ${TODAY} by \`scripts/gen-endpoint-docs.mjs\` (token list from \`lib/bstocks.ts\`, verified on-chain against the issuer beacon). **Mainnet only.**\n\n`;
  md += `## Mainnet index — every base URL and contract the app uses\n\n| Venue / chain | What | Value |\n| --- | --- | --- |\n`;
  md += [
    ['BNB Chain (56)', 'RPC', '`https://bsc-rpc.publicnode.com`, `https://bsc-dataseed1.defibit.io`, `https://bsc-dataseed.bnb.org`'],
    ['BNB Chain (56)', 'USDC / USDT (18 dp)', '`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` / `0x55d398326f99059fF775485246999027B3197955`'],
    ['BNB Chain (56)', 'PancakeSwap V3 SmartRouter / QuoterV2', '`0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` / `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`'],
    ['BNB Chain (56)', 'bStock issuer beacon (identity check)', '`0x156D6dce9a4f6139a3406F1f021F1A4880De93a3`'],
    ['Ethereum (1)', 'USDC (6 dp)', '`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`'],
    ['Lighter', 'REST / WS / signing chain', '`https://mainnet.zklighter.elliot.ai` / `wss://mainnet.zklighter.elliot.ai/stream` / 304'],
    ['Lighter', 'Deposit contract (Ethereum)', 'ZkLighter `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7`'],
    ['Derive', 'REST / WS / EIP-712 chain', '`https://api.derive.xyz/v3` / `wss://api.derive.xyz/v3/ws` / 1'],
    ['Derive', 'Deposit (Ethereum)', 'ActionManager `0xE366CcA474968e33b777E13905829A3b800CFAD3` · protocol USDC asset `0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b`'],
    ['Derive', 'Withdrawal outbox (Ethereum)', '`0x7c743D79C9C595cE332314503d84cBBb4E85FA63`'],
    ['Relay', 'API / router', '`https://api.relay.link` / depository `0x4cd00e387622c35bddb9b4c962c136462338bc31`; Lighter chain id `3586256`'],
    ['Binance (market data)', 'REST', '`https://api.binance.com/api/v3`'],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += `\n\n## bStock token reads (BEP-20 + BEP-677)\n\n| Call | Returns | Note |\n| --- | --- | --- |\n`;
  md += [
    ['`balanceOf(address)`', 'raw balance (18 dp)', 'Does NOT change on a split. Never show it as the position'],
    ['`uiMultiplier()`', 'uint256, 1e18 = 1.0×', 'Position = raw × uiMultiplier ÷ 1e18'],
    ['`newUIMultiplier()`, `effectiveAt()`', 'pending multiplier and when it applies', 'Corporate actions'],
    ['`decimals()`', '18', 'Identity check together with the beacon'],
    ['event `UIMultiplierUpdated(old,new,effectiveAtTimestamp)`', '', 'Watch for splits'],
    ['event `TransferWithUIAmount(from,to,amount,uiAmount)`', '', ''],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += `\n\n## Trading bStocks on-chain (PancakeSwap V3)\n\n| Call | Contract | Detail |\n| --- | --- | --- |\n`;
  md += [
    ['`quoteExactInput(bytes path, uint256 amountIn)`', 'QuoterV2', 'Quote **every** fee tier (100, 500, 2500, 10000): the deepest tier differs per token. Path for USDC: USDC -100-> USDT -fee-> bStock'],
    ['`quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96))`', 'QuoterV2', 'Single hop against USDT'],
    ['`exactInput((path, recipient, amountIn, amountOutMinimum))`', 'SmartRouter', 'No deadline field: wrap in `multicall(uint256 deadline, bytes[] data)`'],
    ['`exactInputSingle((tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96))`', 'SmartRouter', ''],
    ['`approve(SmartRouter, amount)`', 'token', 'Approve the exact amount'],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += `\n\n## bStock market data (Binance spot, public, no key)\n\nSymbol = bStock + \`USDT\`, e.g. \`NVDABUSDT\`. Reference prices only; fills happen on PancakeSwap.\n\n| Endpoint | Returns |\n| --- | --- |\n`;
  md += [
    ['`GET /api/v3/ticker/24hr?symbols=["NVDABUSDT",…]`', 'last, change %, high/low, volume (batch)'],
    ['`GET /api/v3/ticker/price?symbol=`', 'last price'],
    ['`GET /api/v3/depth?symbol=&limit=`', 'order book bids/asks'],
    ['`GET /api/v3/trades?symbol=&limit=`', 'recent trades'],
    ['`GET /api/v3/klines?symbol=&interval=1m|5m|15m|1h|4h|1d|1w&limit=`', 'candles'],
    ['`GET /api/v3/exchangeInfo?symbol=`', 'tick size, lot size, status'],
    ['WS `wss://stream.binance.com:9443/ws/<symbol>@ticker` / `@depth` / `@kline_1m`', 'live streams'],
  ].map((r) => `| ${r.join(' | ')} |`).join('\n');
  md += `\n\n## All verified bStocks on BNB Chain (${tokens.length})\n\nTradeable in the app when pool liquidity ≥ $100k. Lighter has an equity perp with the same underlying symbol for most (hedge leg).\n\n| bStock | Underlying | Name | Contract | Pool liquidity (observed) |\n| --- | --- | --- | --- | --- |\n`;
  md += tokens.map((t) => `| ${t.symbol} | ${t.underlying} | ${t.name} | \`${t.address}\` | $${t.liq.toLocaleString('en-US')} |`).join('\n') + '\n';
  return md;
}

mkdirSync(OUT, { recursive: true });
for (const [name, fn] of [['derive-api', derive], ['lighter-api', lighter], ['relay-api', relay], ['bnb-bstocks', bnb]]) {
  try {
    const md = await fn();
    writeFileSync(path.join(OUT, `${name}.md`), md);
    console.log(`${name}.md  ${(md.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.error(`${name}: FAILED — ${e.message}`);
    process.exitCode = 1;
  }
}
