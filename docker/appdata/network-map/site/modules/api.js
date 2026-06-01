/**
 * Prometheus and Alertmanager API helpers for live health data.
 */

/**
 * Normalize a Prometheus instance label (e.g. "jellyhome:9100") to a hostname.
 * Special-cases "host.docker.internal" → "jellybase".
 */
function normalizeInstance(instance) {
  const hostPort = String(instance || '');
  const host = hostPort.replace(/:\d+$/, '');
  if (host === 'host.docker.internal') return 'jellybase';
  return host;
}

/**
 * Execute a single Prometheus instant query via the nginx proxy.
 * GET /api/prometheus/query?query=<query>
 * Returns the parsed JSON response data.result array, or empty array on failure.
 */
export async function fetchPrometheusQuery(query) {
  try {
    const url = `/api/prometheus/query?query=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Prometheus API ${response.status}`);
    const json = await response.json();
    // Prometheus returns { status: "success", data: { resultType: "...", result: [...] } }
    if (json && json.data && Array.isArray(json.data.result)) {
      return json.data.result;
    }
    return [];
  } catch (err) {
    console.warn('[api] Prometheus query failed:', query, err);
    return [];
  }
}

/**
 * Fetch alerts from Alertmanager via the nginx proxy.
 * GET /api/alerts
 * Returns parsed alerts array, or empty array on failure.
 */
export async function fetchAlertmanagerAlerts() {
  try {
    const response = await fetch('/api/alerts');
    if (!response.ok) throw new Error(`Alertmanager API ${response.status}`);
    const alerts = await response.json();
    return Array.isArray(alerts) ? alerts : [];
  } catch (err) {
    console.warn('[api] Alertmanager fetch failed:', err);
    return [];
  }
}

/**
 * Fetch consolidated health data from multiple Prometheus queries in parallel.
 * Returns an object keyed by normalized hostname with health metrics,
 * plus a timestamp field for refresh tracking.
 */
function metricValue(results, metricKey = 'host') {
  const data = {};
  for (const item of results || []) {
    const key = item.metric?.[metricKey] || item.metric?.monitored_host || normalizeInstance(item.metric?.instance);
    if (!key) continue;
    const value = parseFloat(item.value?.[1]);
    if (Number.isFinite(value)) data[key] = value;
  }
  return data;
}

function metricLabelValue(results, labelName, metricKey = 'host') {
  const data = {};
  for (const item of results || []) {
    const key = item.metric?.[metricKey] || item.metric?.monitored_host || normalizeInstance(item.metric?.instance);
    if (!key) continue;
    const value = item.metric?.[labelName];
    if (value !== undefined) data[key] = value;
  }
  return data;
}

/**
 * Fetch generated read-only backup policy/static management data.
 */
export async function fetchBackupManagementData() {
  try {
    const response = await fetch(`data/backup-management.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`Backup Management data ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn('[api] Backup Management data fetch failed:', err);
    return null;
  }
}

/**
 * Fetch borgmatic backup status metrics from Prometheus.
 */
export async function fetchBackupData() {
  const [successResults, exitResults, timestampResults, durationResults, repoResults, archiveResults, ageResults] = await Promise.all([
    fetchPrometheusQuery('borgmatic_last_run_success'),
    fetchPrometheusQuery('borgmatic_last_run_exit_code'),
    fetchPrometheusQuery('borgmatic_last_run_timestamp_seconds'),
    fetchPrometheusQuery('borgmatic_last_run_duration_seconds'),
    fetchPrometheusQuery('borgmatic_repository_reachable'),
    fetchPrometheusQuery('borgmatic_last_archive_info'),
    fetchPrometheusQuery('time() - borgmatic_last_run_timestamp_seconds'),
  ]);

  const success = metricValue(successResults);
  const exitCode = metricValue(exitResults);
  const timestamp = metricValue(timestampResults);
  const duration = metricValue(durationResults);
  const reachable = metricValue(repoResults);
  const archiveName = metricLabelValue(archiveResults, 'archive_name');
  const age = metricValue(ageResults);
  const hosts = new Set([
    ...Object.keys(success), ...Object.keys(exitCode), ...Object.keys(timestamp),
    ...Object.keys(duration), ...Object.keys(reachable), ...Object.keys(archiveName),
    ...Object.keys(age),
  ]);

  const backups = {timestamp: Date.now()};
  for (const host of hosts) {
    backups[host] = {
      success: success[host],
      exitCode: exitCode[host],
      timestamp: timestamp[host],
      durationSeconds: duration[host],
      repositoryReachable: reachable[host],
      archiveName: archiveName[host],
      ageSeconds: age[host],
    };
  }
  return backups;
}

export async function fetchHealthData() {
  const [
    upResults,
    loadResults,
    memAvailResults,
    memTotalResults,
    diskAvailResults,
    diskTotalResults,
    tempResults,
    mqttUpResults,
    mqttTemperatureResults,
    mqttHumidityResults,
    mqttPressureResults,
    mqttLuxResults,
    mqttProximityResults,
    mqttCpuTemperatureResults,
    mqttDiskUsedResults,
    mqttMemoryAvailableResults,
    mqttWifiRssiResults,
    mqttUptimeResults,
  ] = await Promise.all([
    fetchPrometheusQuery('up{job="node_exporter"}'),
    fetchPrometheusQuery('node_load5{job="node_exporter"}'),
    fetchPrometheusQuery('node_memory_MemAvailable_bytes{job="node_exporter"}'),
    fetchPrometheusQuery('node_memory_MemTotal_bytes{job="node_exporter"}'),
    fetchPrometheusQuery('node_filesystem_avail_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}'),
    fetchPrometheusQuery('node_filesystem_size_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}'),
    fetchPrometheusQuery('node_hwmon_temp_celsius{job="node_exporter"}'),
    fetchPrometheusQuery('up{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_temperature{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_humidity{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_pressure{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_lux{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_proximity{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_cpu_temperature{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_disk_used{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_memory_available{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_wifi_rssi{job="mqtt_exporter",monitored_host="jellyoffice"}'),
    fetchPrometheusQuery('mqtt_uptime{job="mqtt_exporter",monitored_host="jellyoffice"}'),
  ]);

  const health = {};

  // Helper to merge metric values into the health object
  function mergeMetric(results, valueKey) {
    for (const item of results) {
      const instance = item.metric?.instance;
      if (!instance) continue;
      const host = normalizeInstance(instance);
      if (!health[host]) health[host] = {};
      const numValue = parseFloat(item.value?.[1]);
      if (!isNaN(numValue)) {
        health[host][valueKey] = numValue;
      }
    }
  }

  // Process "up" → online boolean
  for (const item of upResults) {
    const instance = item.metric?.instance;
    if (!instance) continue;
    const host = normalizeInstance(instance);
    if (!health[host]) health[host] = {};
    const val = parseFloat(item.value?.[1]);
    health[host].online = val === 1;
  }

  // Process load5
  mergeMetric(loadResults, 'load5');

  // Process memory
  mergeMetric(memAvailResults, 'memAvail');
  mergeMetric(memTotalResults, 'memTotal');

  // Process disk
  mergeMetric(diskAvailResults, 'diskAvail');
  mergeMetric(diskTotalResults, 'diskTotal');

  // Process temperature — take max sensor per host
  for (const item of tempResults) {
    const instance = item.metric?.instance;
    if (!instance) continue;
    const host = normalizeInstance(instance);
    if (!health[host]) health[host] = {};
    const val = parseFloat(item.value?.[1]);
    if (!isNaN(val)) {
      health[host].temp = Math.max(health[host].temp ?? -Infinity, val);
    }
  }
  // Clean up hosts with temp=-Infinity (shouldn't happen but guard)
  for (const host of Object.keys(health)) {
    if (health[host].temp === -Infinity) delete health[host].temp;
  }

  // Mark any host seen in up but without online key
  for (const host of Object.keys(health)) {
    if (health[host].online === undefined) health[host].online = false;
  }

  // MQTT-only constrained sensor nodes, currently jellyoffice.
  // These nodes intentionally do not run node_exporter; mqtt-exporter bridges
  // the publisher's JSON payload into Prometheus scalar metrics.
  function mqttValue(results) {
    const first = results?.[0];
    const value = parseFloat(first?.value?.[1]);
    return Number.isFinite(value) ? value : undefined;
  }

  if (mqttUpResults.length || mqttTemperatureResults.length || mqttCpuTemperatureResults.length) {
    const sensorHost = mqttUpResults[0]?.metric?.monitored_host
      || mqttTemperatureResults[0]?.metric?.monitored_host
      || 'jellyoffice';
    const mqttUp = mqttValue(mqttUpResults);
    health[sensorHost] = {
      ...(health[sensorHost] || {}),
      online: mqttUp === undefined ? true : mqttUp === 1,
      source: 'mqtt',
      sensorTemp: mqttValue(mqttTemperatureResults),
      humidity: mqttValue(mqttHumidityResults),
      pressure: mqttValue(mqttPressureResults),
      lux: mqttValue(mqttLuxResults),
      proximity: mqttValue(mqttProximityResults),
      temp: mqttValue(mqttCpuTemperatureResults),
      diskUsedPct: mqttValue(mqttDiskUsedResults),
      memAvail: mqttValue(mqttMemoryAvailableResults),
      wifiRssi: mqttValue(mqttWifiRssiResults),
      uptimeSeconds: mqttValue(mqttUptimeResults),
    };
  }

  health.timestamp = Date.now();
  return health;
}