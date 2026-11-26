import type { VenueNetwork } from './network';

// Venue endpoints. Verified 2026-11-23 — see docs/endpoints/*.md.
export const LIGHTER = {
  mainnet: { rest: 'https://mainnet.zklighter.elliot.ai', ws: 'wss://mainnet.zklighter.elliot.ai/stream', chainId: 304, l1ChainId: 1, app: 'https://app.lighter.xyz',
    zkLighter: '0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  testnet: { rest: 'https://api.testnet.lighter.xyz', ws: 'wss://api.testnet.lighter.xyz/stream', chainId: 300, l1ChainId: 11155111, app: 'https://testnet.app.lighter.xyz',
    zkLighter: '0x652358Be8bbE20Cb7349ddb8A35dac7c870B4596', usdc: '0xf3E575A90F325a3A806E3CEC99d0baC5719E41eC' },
} as const;

/** App-owned Lighter API key index. 0-3 are reserved by Lighter; registering REPLACES the key at an index. */
export const LIGHTER_API_KEY_INDEX = 4;
export const LIGHTER_USDC_ASSET = 3;

export const DERIVE = {
  mainnet: { rest: 'https://api.derive.xyz/v3', ws: 'wss://api.derive.xyz/v3/ws', chainId: 1, app: 'https://app.derive.xyz',
    actionManager: '0xE366CcA474968e33b777E13905829A3b800CFAD3', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    domainSeparator: '0xda616dfabb88681b08e1592820a41d55ddc62d68de110e327ae99d734506fe19' },
  testnet: { rest: 'https://testnet.api.derive.xyz/v3', ws: 'wss://testnet.api.derive.xyz/v3/ws', chainId: 11155111, app: 'https://testnet.app.derive.xyz',
    actionManager: '0xd3625eCf97E5554C62A48Ac1c9284C9dCeFceB68', usdc: '0x73Efab09362052D26FB93A730Be4F8a5EdC833af',
    domainSeparator: '0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85' },
} as const;

/** Derive's protocol USDC asset (the `asset` arg of deposits/withdraw signing). Same on both nets. */
export const DERIVE_USDC_ASSET = '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b' as const;
export const DERIVE_MATCHING = '0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD' as const;
export const DERIVE_MODULES = {
  TRADE: '0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b',
  TRANSFER: '0x01259207A40925b794C8ac320456F7F6c8FE2636',
  WITHDRAW: '0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083',
  WHITELISTED_RECIPIENT: '0xB86D6DE1b76c9839e4BA860848CD98A1dABd6B54',
  SET_SESSION_KEY: '0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6',
} as const;

/** Custody-safe agent scopes (never admin / set_session_key / transfer:all / different_owner). */
export const DERIVE_AGENT_SCOPES = [
  { code: 2, wire: 'trade:all' },
  { code: 1, wire: 'withdraw' },
  { code: 12, wire: 'transfer:existing_subaccount' },
  { code: 13, wire: 'transfer:new_subaccount' },
] as const;

/** PRIME universe, Standard margin: BTC/ETH options + perps. */
export const DERIVE_DEFAULT_MANAGER_ID = 1;

export function lighterCfg(n: VenueNetwork) { return LIGHTER[n]; }
export function deriveCfg(n: VenueNetwork) { return DERIVE[n]; }

/** Relay (relay.link) — mainnet only; it has no BSC-testnet / Lighter-testnet / Derive routes. */
export const RELAY_API = 'https://api.relay.link';
export const RELAY_LIGHTER_CHAIN_ID = 3586256;
export const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
