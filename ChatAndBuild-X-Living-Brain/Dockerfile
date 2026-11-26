# Pulse Risk web app (Next.js). Node >= 22.5 is required for node:sqlite; 24 has it unflagged.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Some wallet deps (bufferutil, utf-8-validate) compile native addons. The toolchain stays in this stage.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build args.
ARG NEXT_PUBLIC_BSC_RPC_URL=
ARG NEXT_PUBLIC_ETH_RPC_URL=
ARG NEXT_PUBLIC_ARB_RPC_URL=
ARG NEXT_PUBLIC_SEPOLIA_RPC_URL=
ENV NEXT_PUBLIC_BSC_RPC_URL=$NEXT_PUBLIC_BSC_RPC_URL \
    NEXT_PUBLIC_ETH_RPC_URL=$NEXT_PUBLIC_ETH_RPC_URL \
    NEXT_PUBLIC_ARB_RPC_URL=$NEXT_PUBLIC_ARB_RPC_URL \
    NEXT_PUBLIC_SEPOLIA_RPC_URL=$NEXT_PUBLIC_SEPOLIA_RPC_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 HOSTNAME=0.0.0.0 \
    DB_PATH=/app/data/pulsarx.db LIGHTER_WASM_DIR=/app/vendor/lighter
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Read from disk at runtime (path built from process.cwd()), so file tracing does not pick them up:
# the Lighter signer, and the markdown served by /docs.
COPY --chown=node:node vendor/lighter ./vendor/lighter
COPY --chown=node:node docs ./docs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3100
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
