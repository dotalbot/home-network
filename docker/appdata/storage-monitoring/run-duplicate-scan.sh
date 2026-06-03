#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports/czkawka"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

SCAN_PATHS=(/mnt/2TB /opt/docker)
EXCLUDED_DIRS=(/mnt/2TB/lost+found)

mkdir -p "$REPORTS/archive"

if ! command -v czkawka_cli >/dev/null 2>&1; then
  {
    echo "czkawka_cli not installed"
    echo "Date: $(date -Is)"
  } > "$REPORTS/duplicates-latest.txt"
  exit 0
fi

existing_args=()
for path in "${SCAN_PATHS[@]}"; do
  if [ -e "$path" ]; then
    existing_args+=("-d" "$path")
  fi
done

excluded_args=()
for path in "${EXCLUDED_DIRS[@]}"; do
  if [ -e "$path" ]; then
    excluded_args+=("-e" "$path")
  fi
done

if [ "${#existing_args[@]}" -eq 0 ]; then
  {
    echo "No configured scan paths exist on this host."
    echo "Date: $(date -Is)"
  } > "$REPORTS/duplicates-latest.txt"
  exit 0
fi

# Report only. Do not delete anything.
czkawka_cli dup "${existing_args[@]}" "${excluded_args[@]}" -f "$REPORTS/duplicates-latest.txt" || true
czkawka_cli empty-folders "${existing_args[@]}" "${excluded_args[@]}" -f "$REPORTS/empty-folders-latest.txt" || true

cp "$REPORTS/duplicates-latest.txt" "$REPORTS/archive/duplicates-$STAMP.txt" || true
printf 'Duplicate scan complete: %s\n' "$REPORTS"
