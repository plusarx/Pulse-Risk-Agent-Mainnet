// Shared Relay types (client + server).
export type BridgeRoute = 'bsc_to_lighter' | 'bsc_to_eth' | 'eth_to_bsc';

export interface RelayTxStep { id: string; description: string; chainId: number; to: `0x${string}`; data: `0x${string}`; value: string }
export interface RelayQuote {
  requestId: string;
  route: BridgeRoute;
  steps: RelayTxStep[];
  amountIn: string; amountOut: string; minOut: string;
  outDecimals: number; feeUsd: string; timeEstimateSec: number;
}
