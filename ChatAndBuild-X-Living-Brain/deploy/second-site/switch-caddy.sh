#!/usr/bin/env bash
# Make the existing Caddy (project bnb-hackathon, ~/pulsarx) serve BOTH sites, in a way a deployment cannot undo.
# Run from ~/living-brain after `docker network create edge` and after the living-brain containers are up:   bash switch-caddy.sh
#
# Why an override file: the live site's GitHub deployment copies deploy/docker-compose.yml over ~/pulsarx/docker-compose.yml on every release,
# which silently reset an edited compose file back to single-site mode. docker-compose.override.yml is merged automatically and is never touched
# by a deployment. The script validates the Caddyfile and the merged config first, and removes the override again if the live site stops answering.
set -euo pipefail

LIVE=~/pulsarx
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_A="$(grep -m1 -oE '^[^ {#]+\.sslip\.io' "$HERE/Caddyfile")"

docker network inspect edge >/dev/null 2>&1 || { echo "Create the shared network first: docker network create edge"; exit 1; }
[ -f "$HERE/Caddyfile" ] || { echo "Caddyfile not found next to this script"; exit 1; }
docker run --rm -v "$HERE/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile >/dev/null

cd "$LIVE"
[ -f docker-compose.override.yml ] && cp docker-compose.override.yml "docker-compose.override.yml.bak-$(date +%Y%m%d-%H%M%S)"
cp "$HERE/Caddyfile" "$LIVE/Caddyfile"
cat > docker-compose.override.yml <<'OVERRIDE'
# Survives deployments (they only replace docker-compose.yml). Makes the one Caddy serve both sites over the shared "edge" network.
services:
  caddy:
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    networks:
      - default
      - edge
networks:
  edge:
    external: true
OVERRIDE

undo() { rm -f docker-compose.override.yml; docker compose up -d caddy >/dev/null 2>&1 || true; }
docker compose config >/dev/null || { echo "The merged compose config is invalid: removing the override"; undo; exit 1; }
docker compose up -d caddy
sleep 6
if curl -fsS -o /dev/null -m 20 "https://$SITE_A/"; then echo "OK: $SITE_A still answers"; else
  echo "The live site did not answer: removing the override"; undo; exit 1; fi
echo "Done. Caddy now serves both sites; the override is $LIVE/docker-compose.override.yml"
