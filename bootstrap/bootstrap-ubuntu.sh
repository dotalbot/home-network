#!/usr/bin/env bash
set -euo pipefail

ADMIN_USER="${ADMIN_USER:-jellyfish}"
DOCKER_DIR="${DOCKER_DIR:-/opt/docker}"
DOCKER_GROUP="${DOCKER_GROUP:-dockerops}"

echo "==> Home Network bootstrap starting"

if [ "$(id -u)" -ne 0 ]; then
  echo "not good: run with sudo"
  exit 1
fi

echo "==> Updating apt"
apt-get update

echo "==> Installing base packages"
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  git \
  vim \
  tree \
  jq \
  rsync \
  borgbackup \
  borgmatic \
  prometheus-node-exporter \
  smartmontools \
  nvme-cli \
  util-linux \
  lm-sensors \
  sysstat \
  ufw \
  lsb-release \
  software-properties-common

echo "==> Installing yq if missing"
if ! command -v yq >/dev/null 2>&1; then
  wget -qO /usr/local/bin/yq \
    https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
  chmod +x /usr/local/bin/yq
fi

echo "==> Installing just if missing"
if ! command -v just >/dev/null 2>&1; then
  apt-get install -y just || true
fi

echo "==> Installing Docker if missing"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings

  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc

  chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update

  apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
else
  echo "Docker already installed"
fi

echo "==> Enabling Docker"
systemctl enable --now docker

echo "==> Installing Tailscale if missing"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "Tailscale already installed"
fi

echo "==> Enabling Tailscale"
systemctl enable --now tailscaled

echo "==> Creating Docker ops group"
groupadd "$DOCKER_GROUP" 2>/dev/null || true

echo "==> Adding ${ADMIN_USER} to docker and ${DOCKER_GROUP}"
usermod -aG docker "$ADMIN_USER"
usermod -aG "$DOCKER_GROUP" "$ADMIN_USER"

echo "==> Creating deployrr-style Docker layout"
mkdir -p \
  "$DOCKER_DIR/appdata" \
  "$DOCKER_DIR/hosts" \
  "$DOCKER_DIR/.secrets"

if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
  cat > "$DOCKER_DIR/docker-compose.yml" <<'EOF'
services: {}
EOF
fi

echo "==> Applying /opt/docker permissions"
chown -R root:"$DOCKER_GROUP" "$DOCKER_DIR"
chmod -R 775 "$DOCKER_DIR"
find "$DOCKER_DIR" -type d -exec chmod g+s {} \;

echo "==> Ensuring .secrets is tighter"
chmod 770 "$DOCKER_DIR/.secrets"

echo "==> Bootstrap complete"
echo
echo "good"
echo
echo "NOTE: log out and back in for group membership to apply."
echo "NOTE: run 'sudo tailscale up' if this host is not already joined to your tailnet."
