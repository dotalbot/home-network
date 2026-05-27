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
export async function fetchHealthData() {
  const [
    upResults,
    loadResults,
    memAvailResults,
    memTotalResults,
    diskAvailResults,
    diskTotalResults,
    tempResults,
  ] = await Promise.all([
    fetchPrometheusQuery('up{job="node_exporter"}'),
    fetchPrometheusQuery('node_load5{job="node_exporter"}'),
    fetchPrometheusQuery('node_memory_MemAvailable_bytes{job="node_exporter"}'),
    fetchPrometheusQuery('node_memory_MemTotal_bytes{job="node_exporter"}'),
    fetchPrometheusQuery('node_filesystem_avail_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}'),
    fetchPrometheusQuery('node_filesystem_size_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}'),
    fetchPrometheusQuery('node_hwmon_temp_celsius{job="node_exporter"}'),
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

  health.timestamp = Date.now();
  return health;
}