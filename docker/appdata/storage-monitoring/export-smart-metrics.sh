#!/usr/bin/env bash
set -euo pipefail

OUT="${SMART_METRICS_OUT:-/var/lib/node_exporter/textfile_collector/storage_smart.prom}"
OUT_DIR="$(dirname "$OUT")"
HOST="$(hostname -s)"
SMARTCTL="${SMARTCTL:-smartctl}"

if [ ! -d "$OUT_DIR" ]; then
  echo "Prometheus textfile collector dir not present, skipped: $OUT_DIR"
  exit 0
fi

if [ ! -w "$OUT_DIR" ]; then
  echo "Prometheus textfile collector dir not writable, skipped: $OUT_DIR" >&2
  exit 0
fi

if ! command -v "$SMARTCTL" >/dev/null 2>&1; then
  echo "smartctl not installed, skipped" >&2
  exit 0
fi

TMP="$(mktemp "${OUT}.tmp.XXXXXX")"
cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

emit_help() {
  cat <<'EOF'
# HELP storage_monitoring_disk_smart_health SMART health, 1=passed/ok, 0=failed/unknown
# TYPE storage_monitoring_disk_smart_health gauge
# HELP storage_monitoring_disk_temperature_celsius Disk temperature in Celsius from SMART
# TYPE storage_monitoring_disk_temperature_celsius gauge
# HELP storage_monitoring_disk_power_on_hours Disk power-on hours from SMART
# TYPE storage_monitoring_disk_power_on_hours gauge
# HELP storage_monitoring_disk_reallocated_sectors Reallocated sector count from SMART
# TYPE storage_monitoring_disk_reallocated_sectors gauge
# HELP storage_monitoring_disk_current_pending_sectors Current pending sector count from SMART
# TYPE storage_monitoring_disk_current_pending_sectors gauge
# HELP storage_monitoring_disk_offline_uncorrectable Offline uncorrectable sector count from SMART
# TYPE storage_monitoring_disk_offline_uncorrectable gauge
# HELP storage_monitoring_disk_nvme_percentage_used NVMe percentage used from SMART
# TYPE storage_monitoring_disk_nvme_percentage_used gauge
# HELP storage_monitoring_disk_nvme_media_errors NVMe media and data integrity errors from SMART
# TYPE storage_monitoring_disk_nvme_media_errors gauge
# HELP storage_monitoring_disk_smart_probe_success smartctl probe success, 1=probe command succeeded, 0=failed
# TYPE storage_monitoring_disk_smart_probe_success gauge
EOF
}

metric_labels() {
  local dev="$1"
  local kind="$2"
  printf 'host="%s",device="%s",type="%s"' "$HOST" "$(basename "$dev")" "$kind"
}

parse_ata() {
  local dev="$1"
  local kind="$2"
  local file="$3"
  local labels
  labels="$(metric_labels "$dev" "$kind")"

  if grep -Eq 'SMART (overall-health self-assessment test result|Health Status):[[:space:]]*(PASSED|OK)' "$file"; then
    printf 'storage_monitoring_disk_smart_health{%s} 1\n' "$labels"
  else
    printf 'storage_monitoring_disk_smart_health{%s} 0\n' "$labels"
  fi

  awk -v labels="$labels" '
    $1 == "5" {print "storage_monitoring_disk_reallocated_sectors{" labels "} " $NF}
    $1 == "9" {print "storage_monitoring_disk_power_on_hours{" labels "} " $NF}
    $1 == "194" {print "storage_monitoring_disk_temperature_celsius{" labels "} " $10}
    $1 == "197" {print "storage_monitoring_disk_current_pending_sectors{" labels "} " $NF}
    $1 == "198" {print "storage_monitoring_disk_offline_uncorrectable{" labels "} " $NF}
  ' "$file"
}

parse_nvme() {
  local dev="$1"
  local kind="$2"
  local file="$3"
  local labels
  labels="$(metric_labels "$dev" "$kind")"

  if grep -Eq 'SMART overall-health self-assessment test result:[[:space:]]*PASSED' "$file" && grep -Eq 'Critical Warning:[[:space:]]*0x00' "$file"; then
    printf 'storage_monitoring_disk_smart_health{%s} 1\n' "$labels"
  else
    printf 'storage_monitoring_disk_smart_health{%s} 0\n' "$labels"
  fi

  awk -v labels="$labels" '
    /^Temperature:/ {print "storage_monitoring_disk_temperature_celsius{" labels "} " $2}
    /^Percentage Used:/ {gsub(/%/, "", $3); print "storage_monitoring_disk_nvme_percentage_used{" labels "} " $3}
    /^Media and Data Integrity Errors:/ {gsub(/,/, "", $6); print "storage_monitoring_disk_nvme_media_errors{" labels "} " $6}
  ' "$file"
}

{
  emit_help
  "$SMARTCTL" --scan | while read -r dev _ dtype _; do
    [ -n "${dev:-}" ] || continue
    kind="${dtype:-auto}"
    kind="${kind#,}"
    probe="$(mktemp)"
    if "$SMARTCTL" -H -A "$dev" > "$probe" 2>/dev/null; then
      printf 'storage_monitoring_disk_smart_probe_success{%s} 1\n' "$(metric_labels "$dev" "$kind")"
      if [ "$kind" = "nvme" ]; then
        parse_nvme "$dev" "$kind" "$probe"
      else
        parse_ata "$dev" "$kind" "$probe"
      fi
    else
      printf 'storage_monitoring_disk_smart_probe_success{%s} 0\n' "$(metric_labels "$dev" "$kind")"
      printf 'storage_monitoring_disk_smart_health{%s} 0\n' "$(metric_labels "$dev" "$kind")"
    fi
    rm -f "$probe"
  done
} > "$TMP"

chmod 0644 "$TMP"
mv "$TMP" "$OUT"
trap - EXIT
printf 'SMART metrics written: %s\n' "$OUT"
