import { createConfig, fallback, http } from 'wagmi';
import { arbitrum, arbitrumSepolia, bsc, bscTestnet, mainnet, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const bscRpc = process.env.NEXT_PUBLIC_BSC_RPC_URL;

export const wagmiConfig = createConfig({
  // bscTestnet: only for the testnet perps agent approval, whose typed data is bound to chain 97.
  chains: [bsc, mainnet, arbitrum, sepolia, arbitrumSepolia, bscTestnet],
  // EIP-6963 discovery (on by default) adds every installed wallet, e.g. MetaMask as `io.metamask`,
  // even when another extension has taken window.ethereum. `injected()` is the legacy fallback.
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    // Short timeouts + ranking so one slow public RPC can't stall the live balances.
    [bsc.id]: fallback([
      ...(bscRpc ? [http(bscRpc, { timeout: 4_000 })] : []),
      http('https://bsc-rpc.publicnode.com', { timeout: 4_000 }),
      http('https://bsc-dataseed1.defibit.io', { timeout: 4_000 }),
      http('https://bsc-dataseed.bnb.org', { timeout: 4_000 }),
    ], { rank: { interval: 30_000 } }),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARB_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com'),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
    [arbitrumSepolia.id]: http('https://arbitrum-sepolia-rpc.publicnode.com'),
    [bscTestnet.id]: http('https://bsc-testnet-rpc.publicnode.com'),
  },
});

declare module 'wagmi' {
  interface Register { config: typeof wagmiConfig }
}
