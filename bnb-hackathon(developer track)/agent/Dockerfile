# Pulse Risk margin agent. Build from the REPO ROOT (it imports ../lib and ../vendor):
#   docker build -f agent/Dockerfile .
# One image, two roles (see docker-compose.yml):
#   tick loop:  node --import tsx src/index.ts
#   chat API:   node --import tsx src/server.ts
FROM node:24-bookworm-slim
WORKDIR /srv/agent
ENV NODE_ENV=production \
    AGENT_DB_PATH=/srv/agent/data/agent.db
COPY agent/package.json agent/package-lock.json ./
# tsx is a devDependency but is what runs the TypeScript sources, so install everything.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node agent/ ./
COPY --chown=node:node lib/ /srv/lib/
# Shared files in /srv/lib import zod and viem; let them resolve to the agent's copies.
RUN ln -s /srv/agent/node_modules /srv/node_modules \
 && mkdir -p /srv/agent/data && chown -R node:node /srv/agent/data
USER node
VOLUME ["/srv/agent/data"]
CMD ["node", "--import", "tsx", "src/index.ts"]
