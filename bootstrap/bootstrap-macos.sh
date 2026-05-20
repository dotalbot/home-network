#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Homebrew"

if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew"

  /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

echo "==> Updating brew"
brew update

echo "==> Installing packages"

brew install \
  git \
  just \
  tmux \
  jq \
  yq \
  tree \
  rsync \
  htop \
  btop \
  chezmoi

echo "==> Installing casks"

brew install --cask \
  wezterm \
  tailscale

echo "==> Bootstrap complete"
echo "good"
