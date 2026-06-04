#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports/czkawka"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
HOST="$(hostname -s)"
REPORT_RETENTION_DAYS="${REPORT_RETENTION_DAYS:-90}"
if [[ ! "$REPORT_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  REPORT_RETENTION_DAYS=90
fi

CZKAWKA_BIN="${CZKAWKA_BIN:-czkawka_cli}"

case "$HOST" in
  jellyhome)
    DEFAULT_SCAN_PATHS="/home/jellyfish/media/Primary_5TB:/home/jellyfish/media/Backup_5TB:/opt/docker"
    DEFAULT_EXCLUDED_DIRS="/home/jellyfish/media/Primary_5TB/lost+found:/home/jellyfish/media/Backup_5TB/lost+found"
    ;;
  *)
    DEFAULT_SCAN_PATHS="/mnt/2TB:/mnt/4TB:/opt/docker"
    DEFAULT_EXCLUDED_DIRS="/mnt/2TB/lost+found:/mnt/4TB/lost+found"
    ;;
esac

IFS=: read -r -a SCAN_PATHS <<< "${DUPLICATE_SCAN_PATHS:-$DEFAULT_SCAN_PATHS}"
IFS=: read -r -a EXCLUDED_DIRS <<< "${DUPLICATE_EXCLUDED_DIRS:-$DEFAULT_EXCLUDED_DIRS}"

mkdir -p "$REPORTS/archive"

if ! command -v "$CZKAWKA_BIN" >/dev/null 2>&1; then
  {
    echo "$CZKAWKA_BIN not installed"
    echo "Date: $(date -Is)"
  } > "$REPORTS/duplicates-latest.txt"
  exit 0
fi

is_guarded_mount_path() {
  local path="$1"
  [[ "$path" == /mnt/* || "$path" == /home/jellyfish/media/* ]]
}

guarded_mount_available() {
  local path="$1"
  local mount_candidate=""
  local rest=""

  case "$path" in
    /mnt/*)
      rest="${path#/mnt/}"
      mount_candidate="/mnt/${rest%%/*}"
      ;;
    /home/jellyfish/media/*)
      rest="${path#/home/jellyfish/media/}"
      mount_candidate="/home/jellyfish/media/${rest%%/*}"
      ;;
    *)
      return 0
      ;;
  esac

  mountpoint -q "$mount_candidate"
}

existing_args=()
for path in "${SCAN_PATHS[@]}"; do
  if is_guarded_mount_path "$path" && ! guarded_mount_available "$path"; then
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
find "$REPORTS/archive" -type f -name 'duplicates-*.txt' -mtime "+$REPORT_RETENTION_DAYS" -delete 2>/dev/null || true
printf 'Duplicate scan complete: %s\n' "$REPORTS"
