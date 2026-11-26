#!/usr/bin/env bash
# Build and push both images by hand (alternative to the GitHub Actions workflow).
# Builds for linux/amd64 (Lightsail is x86_64) even on an Apple Silicon Mac.
#   docker login ghcr.io -u <github-user>      # password: a PAT with write:packages
#   REGISTRY=ghcr.io/plusarx TAG=latest deploy/push-images.sh
# NEXT_PUBLIC_* are read from the environment and baked into the app image.
# Note: run from a checkout on an APFS/ext4 disk; exFAT drives (._* files) break Docker Desktop's build context.
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY=${REGISTRY:-ghcr.io/plusarx}
TAG=${TAG:-latest}

docker buildx build --platform linux/amd64 --push \
  --build-arg NEXT_PUBLIC_BSC_RPC_URL="${NEXT_PUBLIC_BSC_RPC_URL:-}" \
  --build-arg NEXT_PUBLIC_ETH_RPC_URL="${NEXT_PUBLIC_ETH_RPC_URL:-}" \
  --build-arg NEXT_PUBLIC_ARB_RPC_URL="${NEXT_PUBLIC_ARB_RPC_URL:-}" \
  --build-arg NEXT_PUBLIC_SEPOLIA_RPC_URL="${NEXT_PUBLIC_SEPOLIA_RPC_URL:-}" \
  -t "$REGISTRY/bnb-hackathon-app:$TAG" -f Dockerfile .

docker buildx build --platform linux/amd64 --push \
  -t "$REGISTRY/bnb-hackathon-agent:$TAG" -f agent/Dockerfile .

echo "Pushed $REGISTRY/bnb-hackathon-app:$TAG and $REGISTRY/bnb-hackathon-agent:$TAG"
