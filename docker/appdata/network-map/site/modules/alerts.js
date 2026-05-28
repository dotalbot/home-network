/**
 * Alertmanager alert feed rendering and host matching.
 */
import { escapeHtml, shortName } from './utils.js';

const SEVERITY_RANK = {critical: 0, warning: 1, warn: 1, info: 2, none: 3};

function alertSeverity(alert) {
  return String(alert?.labels?.severity || 'none').toLowerCase();
}

function alertState(alert) {
  return String(alert?.status?.state || 'unknown').toLowerCase();
}

function alertHost(alert) {
  const labels = alert?.labels || {};
  const host = labels.monitored_host || labels.host || labels.instance || labels.job || 'global';
  return String(host).replace(/:\d+$/, '').replace(/^host\.docker\.internal$/, 'jellybase');
}

function alertSummary(alert) {
  return alert?.annotations?.summary || alert?.labels?.alertname || 'Unnamed alert';
}

function alertDescription(alert) {
  return alert?.annotations?.description || '';
}

function sortAlerts(a, b) {
  const severityDelta = (SEVERITY_RANK[alertSeverity(a)] ?? 9) - (SEVERITY_RANK[alertSeverity(b)] ?? 9);
  if (severityDelta) return severityDelta;
  const stateDelta = alertState(a).localeCompare(alertState(b));
  if (stateDelta) return stateDelta;
  return new Date(b.startsAt || 0) - new Date(a.startsAt || 0);
}

function humanSince(iso) {
  if (!iso) return 'n/a';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function normalizeAlertHost(alert) {
  return alertHost(alert).toLowerCase();
}

export function groupAlertsByHost(alerts) {
  const groups = {};
  for (const alert of alerts || []) {
    const host = alertHost(alert);
    if (!groups[host]) groups[host] = [];
    groups[host].push(alert);
  }
  for (const host of Object.keys(groups)) groups[host].sort(sortAlerts);
  return groups;
}

export function renderAlertFeed(alerts) {
  const sorted = [...(alerts || [])].sort(sortAlerts);
  if (!sorted.length) {
    return '<p class="muted">No active Alertmanager alerts.</p>';
  }

  const groups = groupAlertsByHost(sorted);
  return `
    <div class="alert-feed">
      ${Object.entries(groups).map(([host, hostAlerts]) => `
        <section class="alert-host-group">
          <h4>${escapeHtml(shortName(host))} <span>${hostAlerts.length}</span></h4>
          <div class="alert-list">
            ${hostAlerts.map(alert => {
              const severity = alertSeverity(alert);
              const state = alertState(alert);
              const name = alert?.labels?.alertname || 'alert';
              return `
                <button class="alert-card alert-${escapeHtml(severity)}" data-alert-host="${escapeHtml(alertHost(alert))}" type="button">
                  <span class="alert-card-top">
                    <strong>${escapeHtml(alertSummary(alert))}</strong>
                    <em>${escapeHtml(severity)}</em>
                  </span>
                  <span class="alert-meta">${escapeHtml(name)} · ${escapeHtml(state)} · ${escapeHtml(humanSince(alert.startsAt))}</span>
                  ${alertDescription(alert) ? `<span class="alert-description">${escapeHtml(alertDescription(alert))}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}

export function alertCountByHost(alerts) {
  const counts = {};
  for (const alert of alerts || []) {
    const host = normalizeAlertHost(alert);
    counts[host] = (counts[host] || 0) + 1;
  }
  return counts;
}
