#!/usr/bin/env bash
set -u

URLS=(
  "http://jellyhome:3000"
  "http://jellyhome:8080"
  "https://jellyhome:9443/api/status"
  "http://jellyhome:19999/api/v1/info"
  "http://jellybase:3000"
  "http://jellybase:19999/api/v1/info"
  "http://jellybase:9090/-/ready"
  "http://jellybase:3001/api/health"
)

for url in "${URLS[@]}"; do
  if ! curl -kfsS --max-time 5 "$url" >/dev/null 2>&1; then
    echo "not good"
    exit 1
  fi
done

echo "good"
exit 0
