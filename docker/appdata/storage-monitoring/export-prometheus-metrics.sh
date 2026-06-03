#!/usr/bin/env bash
set -euo pipefail

BASE="${STORAGE_MONITORING_BASE:-/opt/docker/appdata/storage-monitoring}"
REPORTS="$BASE/reports"
OUT="${NODE_EXPORTER_TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}/storage_monitoring.prom"
TMP="${OUT}.tmp"

mkdir -p "$(dirname "$OUT")"

scan_success=0
if [ -s "$REPORTS/summary-latest.txt" ]; then
  scan_success=1
fi

summary_mtime=0
if [ -e "$REPORTS/summary-latest.txt" ]; then
  summary_mtime="$(stat -c %Y "$REPORTS/summary-latest.txt")"
fi

duplicate_mtime=0
if [ -e "$REPORTS/czkawka/duplicates-latest.txt" ]; then
  duplicate_mtime="$(stat -c %Y "$REPORTS/czkawka/duplicates-latest.txt")"
fi

{
  echo "# HELP storage_monitoring_scan_success Whether the latest storage monitoring scan produced a summary report"
  echo "# TYPE storage_monitoring_scan_success gauge"
  echo "storage_monitoring_scan_success{host=\"$(hostname -s)\"} $scan_success"

  echo "# HELP storage_monitoring_summary_report_mtime_seconds Unix mtime of latest storage summary report"
  echo "# TYPE storage_monitoring_summary_report_mtime_seconds gauge"
  echo "storage_monitoring_summary_report_mtime_seconds{host=\"$(hostname -s)\"} $summary_mtime"

  echo "# HELP storage_monitoring_duplicate_report_mtime_seconds Unix mtime of latest duplicate report"
  echo "# TYPE storage_monitoring_duplicate_report_mtime_seconds gauge"
  echo "storage_monitoring_duplicate_report_mtime_seconds{host=\"$(hostname -s)\"} $duplicate_mtime"

  echo "# HELP storage_monitoring_filesystem_used_percent Filesystem used percent from df"
  echo "# TYPE storage_monitoring_filesystem_used_percent gauge"
  df -P -T | awk 'NR>1 {
    filesystem=$1;
    fstype=$2;
    mountpoint=$7;
    used=$6;
    gsub("%", "", used);
    gsub(/\\/, "\\\\", filesystem);
    gsub(/"/, "\\\"", filesystem);
    gsub(/\\/, "\\\\", mountpoint);
    gsub(/"/, "\\\"", mountpoint);
    print "storage_monitoring_filesystem_used_percent{host=\"'"$(hostname -s)"'\",filesystem=\"" filesystem "\",fstype=\"" fstype "\",mountpoint=\"" mountpoint "\"} " used
  }'
} > "$TMP"

mv "$TMP" "$OUT"
chmod 0644 "$OUT" 2>/dev/null || true
printf 'Metrics written: %s\n' "$OUT"
