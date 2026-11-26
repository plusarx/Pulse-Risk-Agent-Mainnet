/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Docker build sets NEXT_OUTPUT=standalone for a small self-contained server; local dev is unchanged.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  // node:sqlite is a Node builtin; keep it out of the bundle.
  serverExternalPackages: [],
  webpack: (config) => {
    // wagmi/walletconnect optional deps we don't use
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.alias = { ...config.resolve.alias, '@react-native-async-storage/async-storage': false };
    return config;
  },
};
export default nextConfig;
