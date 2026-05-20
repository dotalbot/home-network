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
