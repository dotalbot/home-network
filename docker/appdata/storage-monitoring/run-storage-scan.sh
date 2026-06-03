#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports"
DUC_DIR="$BASE/duc"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

SCAN_PATHS=(/mnt/2TB /mnt/4TB /opt/docker)

mkdir -p "$REPORTS/archive" "$DUC_DIR"

existing_scan_paths=()
for path in "${SCAN_PATHS[@]}"; do
  if [[ "$path" == /mnt/* ]] && ! mountpoint -q "$path"; then
    continue
  fi
  if [ -e "$path" ]; then
    existing_scan_paths+=("$path")
  fi
done

{
  echo "# Storage Scan Report"
  echo
  echo "Host: $(hostname -s)"
  echo "Date: $(date -Is)"
  echo
  echo "## Scan paths"
  if [ "${#existing_scan_paths[@]}" -eq 0 ]; then
    echo "No configured scan paths exist on this host."
  else
    printf '%s\n' "${existing_scan_paths[@]}"
  fi
  echo
  echo "## df -hT"
  df -hT
  echo
  echo "## lsblk"
  lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL
} > "$REPORTS/summary-latest.txt"

if command -v duc >/dev/null 2>&1 && [ "${#existing_scan_paths[@]}" -gt 0 ]; then
  duc index -d "$DUC_DIR/root.duc" "${existing_scan_paths[@]}" 2>"$REPORTS/duc-errors-latest.txt" || true
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

printf 'Storage scan complete: %s\n' "$REPORTS"
