# syntax=docker/dockerfile:1

FROM lscr.io/linuxserver/webtop:ubuntu-xfce

ARG DEBIAN_FRONTEND=noninteractive
ARG KROKIET_VERSION=11.0.1
ARG TARGETARCH

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    duf \
    jq \
    mc \
    ncdu \
    p7zip-full \
    ranger \
    rsync \
    tree \
    unzip \
    xdg-utils \
    zip \
    libegl1 \
    libfontconfig1 \
    libgl1 \
    libgtk-3-0 \
    libxkbcommon0 \
    libxcb1 \
    libxcb-render0 \
    libxcb-shape0 \
    libxcb-xfixes0 \
  && rm -rf /var/lib/apt/lists/*

RUN test -n "${TARGETARCH}" \
  && case "${TARGETARCH}" in \
      amd64) \
        krokiet_asset="linux_krokiet_x86_64"; \
        krokiet_sha256="1d33483a11d166af7e98ae2e6c2c7d34f84b3f813a7a68f2bab02dc807bbca9c"; \
        ;; \
      arm64) \
        krokiet_asset="linux_krokiet_arm64"; \
        krokiet_sha256="523d3f3b600eac8d7d087f505db52f849b9546445a82c82f250561349fb9c274"; \
        ;; \
      *) \
        echo "unsupported TARGETARCH=${TARGETARCH:-unset}" >&2; \
        exit 1; \
        ;; \
    esac \
  && curl -fsSL "https://github.com/qarmin/czkawka/releases/download/${KROKIET_VERSION}/${krokiet_asset}" -o /usr/local/bin/krokiet \
  && echo "${krokiet_sha256}  /usr/local/bin/krokiet" | sha256sum -c - \
  && chmod 0755 /usr/local/bin/krokiet \
  && ln -sf /usr/local/bin/krokiet /usr/local/bin/czkawka-gui

RUN cat > /usr/share/applications/krokiet.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Krokiet
Comment=Actively developed Czkawka GUI for finding duplicates and unnecessary files
Exec=/usr/local/bin/krokiet
Icon=system-search
Terminal=false
Categories=Utility;Filesystem;
EOF

LABEL org.opencontainers.image.title="home-network-webtop-cleanup" \
      org.opencontainers.image.description="LinuxServer Webtop with disk cleanup tools and Krokiet/Czkawka GUI" \
      org.opencontainers.image.source="https://github.com/dotalbot/home-network"
