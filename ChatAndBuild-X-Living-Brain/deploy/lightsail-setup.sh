#!/usr/bin/env bash
# One-time setup on a fresh Lightsail Ubuntu 24.04 instance. Run as the default `ubuntu` user:
#   curl -fsSL <raw url of this file> | bash      (or scp it over and `bash lightsail-setup.sh`)
# Installs Docker Engine + compose plugin and adds a 2 GB swap file (the Next.js build is memory hungry).
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo systemctl enable --now docker
mkdir -p "$HOME/pulsarx"
echo "Done. Log out and back in (for the docker group), then:"
echo "  cd ~/pulsarx   # put .env and agent.env here (scp); the GitHub deploy job copies docker-compose.yml"
echo "  echo <PAT with read:packages> | docker login ghcr.io -u <github-user> --password-stdin   # private images only"
echo "  docker compose pull && docker compose up -d"
