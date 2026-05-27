/**
 * Node health overlay module for the Network Map dashboard.
 * Renders health badges on topology nodes and enriches popovers with health details.
 */
import { $, escapeHtml } from './utils.js';

/**
 * Determine the health status color for a host.
 *   green  — online, no warnings
 *   amber  — online but disk >80% or temp >60°C
 *   red    — offline or critical condition
 *   grey   — no data available
 */
function healthColor(hostHealth) {
  if (!hostHealth) return 'grey';
  if (hostHealth.online === false) return 'red';
  if (hostHealth.online === undefined) return 'grey';

  // Check MQTT-reported disk usage warning for constrained sensor nodes
  if (hostHealth.diskUsedPct !== undefined) {
    if (hostHealth.diskUsedPct > 90) return 'red';
    if (hostHealth.diskUsedPct > 80) return 'amber';
  }

  // Check disk usage warning
  if (hostHealth.diskTotal > 0) {
    const diskPct = (hostHealth.diskAvail ?? 0) / hostHealth.diskTotal;
    if (diskPct < 0.2) return 'red';      // <20% free = critical
    if (diskPct < 0.35) return 'amber';    // <35% free = warning
  }

  // Check temperature warning
  if (hostHealth.temp !== undefined && hostHealth.temp > 70) return 'red';
  if (hostHealth.temp !== undefined && hostHealth.temp > 60) return 'amber';

  return 'green';
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return 'n/a';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

/**
 * Format a percentage value.
 */
function formatPct(ratio) {
  if (ratio === undefined || ratio === null || isNaN(ratio)) return 'n/a';
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatOptional(value, suffix = '', digits = 1) {
  if (value === undefined || value === null || isNaN(value)) return 'n/a';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function formatUptime(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return 'n/a';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Render health badge HTML strings for topology nodes.
 * Returns an empty string if no health data available.
 */
export function renderHealthBadges(healthData) {
  if (!healthData || !Object.keys(healthData).length) return '';
  // This is handled by attachHealthToNodes instead — badges are overlaid on existing nodes.
  return '';
}

/**
 * After DOM render, attach health data to topology node elements
 * via data attributes and add health badge overlays.
 *
 * @param {Object} healthData - The consolidated health object keyed by hostname
 * @param {Array} inventoryItems - The flat list of inventory items (lan_devices + tailnet_peers)
 */
export function attachHealthToNodes(healthData, inventoryItems) {
  if (!healthData) return;

  // Build a map from IP → hostname for matching inventory items to health data
  const ipToHostname = {};
  const ipToDisplayName = {};
  const hostnameToIp = {};
  for (const item of inventoryItems) {
    // Match on hostname (stripping .lan/.local/.ts.net), display_name, or IP
    const displayName = (item.display_name || '').replace(/\.lan$|\.local$|\.cheetah-iwato\.ts\.net$/i, '').toLowerCase();
    const hostname = (item.hostname || '').replace(/\.lan$|\.local$|\.cheetah-iwato\.ts\.net$/i, '').toLowerCase();
    const ip = item.ip;
    ipToHostname[ip] = hostname || displayName;
    ipToDisplayName[ip] = displayName;
    hostnameToIp[hostname || displayName] = ip;
    hostnameToIp[ip] = ip;
  }

  // For each topology node button, find matching health data
  document.querySelectorAll('.topology-node').forEach(el => {
    const ip = el.dataset.ip;
    if (!ip) return;

    // Try to match via hostname derived from inventory, then IP
    const hostname = ipToHostname[ip];
    const displayName = ipToDisplayName[ip];
    let hostHealth = null;

    // Try hostname match first, then direct key lookup
    if (hostname && healthData[hostname]) {
      hostHealth = healthData[hostname];
    } else {
      // Try to find any health key that could match this device
      // Check using IP-based or partial hostname matching
      for (const [healthKey, val] of Object.entries(healthData)) {
        if (healthKey === 'timestamp') continue;
        if (typeof val === 'object' && val !== null) {
          // Check if the health key matches the device hostname/display_name
          const key = healthKey.toLowerCase();
          if (key === hostname || key === displayName || key === ip) {
            hostHealth = val;
            break;
          }
        }
      }
    }

    if (!hostHealth) return;

    // Store health data on the element for popup use
    el.dataset.healthHost = hostname || ip;
    el.dataset.healthOnline = String(hostHealth.online ?? '');
    el.dataset.healthColor = healthColor(hostHealth);

    // Add health badge overlay
    const badge = document.createElement('span');
    badge.className = `health-badge health-${healthColor(hostHealth)}`;
    badge.title = hostHealth.online ? 'Online' : (hostHealth.online === false ? 'Offline' : 'No data');
    el.appendChild(badge);
  });
}

/**
 * Render health detail HTML for a popover.
 * Called when a topology node popup is shown and the node has health data.
 *
 * @param {Object} hostHealth - The health metrics for this host
 * @returns {string} HTML string for the health detail section
 */
export function renderHealthDetail(hostHealth) {
  if (!hostHealth) return '';

  const color = healthColor(hostHealth);
  const statusLabel = hostHealth.online ? 'Online' : (hostHealth.online === false ? 'Offline' : 'Unknown');
  const memPct = (hostHealth.memTotal > 0) ? (hostHealth.memAvail ?? 0) / hostHealth.memTotal : null;
  const usedMemPct = memPct !== null ? 1 - memPct : null;
  const diskPct = (hostHealth.diskTotal > 0) ? (hostHealth.diskAvail ?? 0) / hostHealth.diskTotal : null;
  const usedDiskPct = diskPct !== null ? 1 - diskPct : null;

  return `
    <div class="health-detail">
      <h4 class="health-title">Node health <span class="health-badge-inline health-${color}">${statusLabel}</span></h4>
      <dl>
        <dt>Status</dt>
        <dd><span class="health-status-dot health-${color}"></span> ${escapeHtml(statusLabel)}${hostHealth.source === 'mqtt' ? ' · MQTT telemetry' : ''}</dd>
        <dt>CPU load (5m)</dt>
        <dd>${hostHealth.load5 !== undefined ? escapeHtml(hostHealth.load5.toFixed(2)) : 'n/a'}</dd>
        <dt>Memory</dt>
        <dd>${usedMemPct !== null ? `${formatPct(usedMemPct)} used (${formatBytes(hostHealth.memTotal)} total)` : (hostHealth.memAvail !== undefined ? `${formatOptional(hostHealth.memAvail, ' MiB', 0)} available` : 'n/a')}</dd>
        <dt>Disk /</dt>
        <dd>${usedDiskPct !== null ? `${formatPct(usedDiskPct)} used (${formatBytes(hostHealth.diskTotal)} total)` : (hostHealth.diskUsedPct !== undefined ? `${formatOptional(hostHealth.diskUsedPct, '%', 1)} used` : 'n/a')}</dd>
        <dt>CPU temperature</dt>
        <dd>${hostHealth.temp !== undefined ? `${hostHealth.temp.toFixed(1)} °C` : 'n/a'}</dd>
        ${hostHealth.sensorTemp !== undefined ? `<dt>Enviro temperature</dt><dd>${formatOptional(hostHealth.sensorTemp, ' °C', 1)}</dd>` : ''}
        ${hostHealth.humidity !== undefined ? `<dt>Humidity</dt><dd>${formatOptional(hostHealth.humidity, '%', 1)}</dd>` : ''}
        ${hostHealth.pressure !== undefined ? `<dt>Pressure</dt><dd>${formatOptional(hostHealth.pressure, ' hPa', 1)}</dd>` : ''}
        ${hostHealth.lux !== undefined ? `<dt>Light</dt><dd>${formatOptional(hostHealth.lux, ' lx', 1)}</dd>` : ''}
        ${hostHealth.proximity !== undefined ? `<dt>Proximity</dt><dd>${formatOptional(hostHealth.proximity, '', 0)}</dd>` : ''}
        ${hostHealth.wifiRssi !== undefined ? `<dt>Wi-Fi RSSI</dt><dd>${formatOptional(hostHealth.wifiRssi, ' dBm', 0)}</dd>` : ''}
        ${hostHealth.uptimeSeconds !== undefined ? `<dt>Uptime</dt><dd>${escapeHtml(formatUptime(hostHealth.uptimeSeconds))}</dd>` : ''}
      </dl>
    </div>
  `;
}

/**
 * Find health data for a given inventory item by matching hostname/IP.
 *
 * @param {Object} healthData - The consolidated health object
 * @param {Object} item - An inventory item
 * @returns {Object|null} The health metrics for this host, or null
 */
export function findHealthForItem(healthData, item) {
  if (!healthData) return null;

  const displayName = (item.display_name || '').replace(/\.lan$|\.local$|\.cheetah-iwato\.ts\.net$/i, '').toLowerCase();
  const hostname = (item.hostname || '').replace(/\.lan$|\.local$|\.cheetah-iwato\.ts\.net$/i, '').toLowerCase();
  const ip = item.ip;

  // Direct hostname match
  if (hostname && healthData[hostname]) return healthData[hostname];
  // Display name match
  if (displayName && healthData[displayName]) return healthData[displayName];
  // IP match (unlikely but possible)
  if (ip && healthData[ip]) return healthData[ip];

  // Fuzzy: check all health keys against hostname/display_name
  for (const [key, val] of Object.entries(healthData)) {
    if (key === 'timestamp') continue;
    if (typeof val !== 'object' || val === null) continue;
    const k = key.toLowerCase();
    if (k === hostname || k === displayName || k === ip) return val;
  }

  return null;
}