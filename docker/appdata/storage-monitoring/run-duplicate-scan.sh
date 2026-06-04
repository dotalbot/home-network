#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports/czkawka"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

CZKAWKA_BIN="${CZKAWKA_BIN:-czkawka_cli}"

SCAN_PATHS=(/mnt/2TB /mnt/4TB /opt/docker)
EXCLUDED_DIRS=(/mnt/2TB/lost+found /mnt/4TB/lost+found)

mkdir -p "$REPORTS/archive"

if ! command -v "$CZKAWKA_BIN" >/dev/null 2>&1; then
  {
    echo "$CZKAWKA_BIN not installed"
    echo "Date: $(date -Is)"
  } > "$REPORTS/duplicates-latest.txt"
  exit 0
fi

existing_args=()
for path in "${SCAN_PATHS[@]}"; do
  if [[ "$path" == /mnt/* ]] && ! mountpoint -q "$path"; then
    continue
  fi
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
{
  echo "Czkawka duplicate scan"
  echo "Date: $(date -Is)"
  echo "Binary: $(command -v "$CZKAWKA_BIN")"
  "$CZKAWKA_BIN" --version || true
  echo
  "$CZKAWKA_BIN" dup "${existing_args[@]}" "${excluded_args[@]}"
} > "$REPORTS/duplicates-latest.txt" 2> "$REPORTS/duplicates-errors-latest.txt" || true

{
  echo "Czkawka empty-folder scan"
  echo "Date: $(date -Is)"
  echo
  "$CZKAWKA_BIN" empty-folders "${existing_args[@]}" "${excluded_args[@]}"
} > "$REPORTS/empty-folders-latest.txt" 2> "$REPORTS/empty-folders-errors-latest.txt" || true

cp "$REPORTS/duplicates-latest.txt" "$REPORTS/archive/duplicates-$STAMP.txt" || true
printf 'Duplicate scan complete: %s\n' "$REPORTS"
