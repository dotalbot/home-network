#!/usr/bin/env bash
set -euo pipefail

ADMIN_USER="${ADMIN_USER:-jellyfish}"

sudo apt-get update

sudo apt-get install -y \
  git \
  vim \
  curl \
  tree \
  jq \
  rsync \
  borgbackup \
  ufw

echo "==> Installing Docker if missing"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Installing Tailscale"

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

sudo systemctl enable --now docker
sudo systemctl enable --now tailscaled

sudo usermod -aG docker "$ADMIN_USER"

sudo mkdir -p /opt/docker/{appdata,hosts,.secrets}

echo "good"
