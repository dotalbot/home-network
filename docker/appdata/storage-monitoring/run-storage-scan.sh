#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports"
DUC_DIR="$BASE/duc"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
HOST="$(hostname -s)"
REPORT_RETENTION_DAYS="${REPORT_RETENTION_DAYS:-90}"
if [[ ! "$REPORT_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  REPORT_RETENTION_DAYS=90
fi

case "$HOST" in
  jellyhome)
    DEFAULT_SCAN_PATHS="/home/jellyfish/media/Primary_5TB:/home/jellyfish/media/Backup_5TB:/opt/docker"
    ;;
  *)
    DEFAULT_SCAN_PATHS="/mnt/2TB:/mnt/4TB:/opt/docker"
    ;;
esac

IFS=: read -r -a SCAN_PATHS <<< "${STORAGE_SCAN_PATHS:-$DEFAULT_SCAN_PATHS}"
IFS=: read -r -a DUC_SCAN_PATHS <<< "${DUC_SCAN_PATHS:-${STORAGE_SCAN_PATHS:-$DEFAULT_SCAN_PATHS}}"

mkdir -p "$REPORTS/archive" "$DUC_DIR"

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

collect_existing_paths() {
  local -n input_paths="$1"
  local -n output_paths="$2"
  local path

  for path in "${input_paths[@]}"; do
    if is_guarded_mount_path "$path" && ! guarded_mount_available "$path"; then
      continue
    fi
    if [ -e "$path" ]; then
      output_paths+=("$path")
    fi
  done
}

existing_scan_paths=()
existing_duc_paths=()
collect_existing_paths SCAN_PATHS existing_scan_paths
collect_existing_paths DUC_SCAN_PATHS existing_duc_paths

{
  echo "# Storage Scan Report"
  echo
  echo "Host: $HOST"
  echo "Date: $(date -Is)"
  echo
  echo "## Scan paths"
  if [ "${#existing_scan_paths[@]}" -eq 0 ]; then
    echo "No configured scan paths exist on this host."
  else
    printf '%s\n' "${existing_scan_paths[@]}"
  fi
  echo
  echo "## Duc paths"
  if [ "${#existing_duc_paths[@]}" -eq 0 ]; then
    echo "No configured Duc paths exist on this host."
  else
    printf '%s\n' "${existing_duc_paths[@]}"
  fi
  echo
  echo "## df -hT"
  df -hT
  echo
  echo "## lsblk"
  lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL
} > "$REPORTS/summary-latest.txt"

if command -v duc >/dev/null 2>&1 && [ "${#existing_duc_paths[@]}" -gt 0 ]; then
  duc index -d "$DUC_DIR/root.duc" "${existing_duc_paths[@]}" 2>"$REPORTS/duc-errors-latest.txt" || true
  duc info -d "$DUC_DIR/root.duc" > "$REPORTS/duc-info-latest.txt" 2>&1 || true
  duc ls -d "$DUC_DIR/root.duc" / > "$REPORTS/duc-ls-latest.txt" 2>&1 || true
else
  {
    echo "duc not installed or no scan paths available"
    echo "Date: $(date -Is)"
  } > "$REPORTS/duc-info-latest.txt"
fi

{
  echo "# Borg Repository Quick Check"
  echo
  echo "Date: $(date -Is)"
  echo
  echo "Candidate repos from shallow path probe:"
  find /mnt /media /srv /backup /backups /opt -maxdepth 4 -type d -name "data" 2>/dev/null | head -100 || true
  echo
  echo "Note: this report does not modify Borg repositories. Detailed borg info requires configured credentials."
} > "$REPORTS/borg-latest.txt"

cp "$REPORTS/summary-latest.txt" "$REPORTS/archive/summary-$STAMP.txt"
find "$REPORTS/archive" -type f -name 'summary-*.txt' -mtime "+$REPORT_RETENTION_DAYS" -delete 2>/dev/null || true

printf 'Storage scan complete: %s\n' "$REPORTS"
