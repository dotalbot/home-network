set shell := ["bash", "-cu"]

default:
    just --list

status:
    ./scripts/status

deploy:
    ./scripts/deploy

compose-config:
    cd /opt/docker && docker compose \
      --env-file .env \
      -f docker-compose.yml \
      -f hosts/$(hostname -s).yaml \
      config

ps:
    docker ps

logs service:
    docker logs --tail=100 -f {{service}}

restart service:
    cd /opt/docker && docker compose \
      --env-file .env \
      -f docker-compose.yml \
      -f hosts/$(hostname -s).yaml \
      restart {{service}}

up service:
    cd /opt/docker && docker compose \
      --env-file .env \
      -f docker-compose.yml \
      -f hosts/$(hostname -s).yaml \
      up -d {{service}}

down service:
    cd /opt/docker && docker compose \
      --env-file .env \
      -f docker-compose.yml \
      -f hosts/$(hostname -s).yaml \
      stop {{service}}

sync-docker-config:
    ./scripts/sync-docker-config

homepage-render:
    ./scripts/homepage-render

network-map-render:
    ./scripts/network-map-render

homepage-deploy:
    ./scripts/homepage-render
    ./scripts/network-map-render
    ./scripts/sync-docker-config
    ./scripts/deploy

drift-check:
    -./scripts/drift-check

drift-check-strict:
    ./scripts/drift-check

backup-policy-check:
    ./scripts/backup-policy-check

host-monitoring-policy-check:
    ./scripts/host-monitoring-policy-check

scheduled-ops-check:
    ./scripts/scheduled-ops-check

scheduled-ops-check-with-render-validation:
    ./scripts/scheduled-ops-check --dashboard-render-checks

borg-check:
    ./scripts/borg-check

borgmatic-rollout-discovery:
    ./scripts/borgmatic-rollout-discovery

borgmatic-rollout-generate:
    ./scripts/borgmatic-rollout-generate

node-exporter-rollout-generate:
    ./scripts/node-exporter-rollout-generate

install-seedit4me-reverse-tunnel:
    ./scripts/install-seedit4me-reverse-tunnel
