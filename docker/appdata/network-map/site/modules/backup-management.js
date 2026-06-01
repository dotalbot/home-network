/**
 * Read-only Backup Management view.
 * Renders generated inventory policy plus live borgmatic metric overlays.
 */
import { escapeHtml } from './utils.js';

const STALE_AFTER_SECONDS = 36 * 60 * 60;

function backupForHost(liveBackupData, hostName) {
  if (!liveBackupData || !hostName) return null;
  return liveBackupData[hostName] || liveBackupData[String(hostName).toLowerCase()] || null;
}

function hostAlerts(alerts, hostName) {
  const normalized = String(hostName || '').toLowerCase();
  return (alerts || []).filter((alert) => {
    const labels = alert.labels || {};
    const haystack = [labels.host, labels.monitored_host, labels.instance, labels.alertname, labels.job]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized) && /backup|borg|textfile/i.test(haystack);
  });
}

function liveState(host, liveBackupData, alerts) {
  if (!host?.enabled) {
    return {color: 'grey', label: 'Disabled/planned', reason: 'Inventory destination is disabled or planned.'};
  }
  const backup = backupForHost(liveBackupData, host.name);
  const relatedAlerts = hostAlerts(alerts, host.name);
  if (relatedAlerts.some((alert) => /critical|error|fail/i.test(alert.labels?.severity || alert.labels?.alertname || ''))) {
    return {color: 'red', label: 'Alerting', reason: 'Backup-related alert is firing.'};
  }
  if (!backup) {
    return {color: 'amber', label: 'Unknown', reason: 'No live borgmatic metrics were returned for this expected backup host.'};
  }
  if (backup.repositoryReachable === 0 || backup.success === 0 || (backup.exitCode !== undefined && backup.exitCode !== 0)) {
    return {color: 'red', label: 'Failed', reason: 'Latest metrics report failure, non-zero exit, or unreachable repository.'};
  }
  if (backup.ageSeconds === undefined || backup.ageSeconds === null) {
    return {color: 'amber', label: 'Unknown', reason: 'Last-run age metric is missing.'};
  }
  if (Number(backup.ageSeconds) > STALE_AFTER_SECONDS) {
    return {color: 'amber', label: 'Stale', reason: 'Latest run is older than the daily-backup stale threshold.'};
  }
  if (backup.success === 1 && backup.repositoryReachable === 1) {
    return {color: 'green', label: 'Healthy', reason: 'Latest backup succeeded recently and repository is reachable.'};
  }
  return {color: 'amber', label: 'Unknown', reason: 'Live metrics are incomplete; unknown is not treated as healthy.'};
}

function humanDuration(seconds) {
  if (seconds === undefined || seconds === null || Number.isNaN(Number(seconds))) return 'unknown';
  const value = Number(seconds);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  if (value < 86400) return `${Math.round(value / 3600)}h`;
  return `${Math.round(value / 86400)}d`;
}

function formatList(items, empty = 'none recorded') {
  const values = (items || []).filter(Boolean);
  if (!values.length) return `<span class="muted">${escapeHtml(empty)}</span>`;
  return `<ul>${values.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`;
}

function formatLink(link, label) {
  if (!link?.url) return '<span class="muted">not recorded</span>';
  return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(label || link.path || link.url)}</a>`;
}

function renderSummaryCards(data, states) {
  const healthy = states.filter(state => state.color === 'green').length;
  const attention = states.filter(state => ['amber', 'red'].includes(state.color)).length;
  const disabled = states.filter(state => state.color === 'grey').length;
  const target = data?.primary_target || {};
  return `
    <div class="backup-mgmt-summary">
      <div class="stat"><strong>${escapeHtml(String(data?.summary?.enabled_backup_hosts ?? 0))}</strong><span>Enabled backup hosts</span></div>
      <div class="stat"><strong>${escapeHtml(String(healthy))}</strong><span>Healthy from live metrics</span></div>
      <div class="stat"><strong>${escapeHtml(String(attention))}</strong><span>Needs attention / unknown</span></div>
      <div class="stat"><strong>${escapeHtml(String(disabled))}</strong><span>Disabled or planned</span></div>
      <div class="stat backup-target-card"><strong>${escapeHtml(target.host || 'unknown')}</strong><span>${escapeHtml(target.lan_ip || 'LAN IP unknown')} · ${escapeHtml(target.address_policy || 'policy unknown')}</span></div>
    </div>
  `;
}

function renderHostTable(data, liveBackupData, alerts, statesByHost) {
  const hosts = data?.hosts || [];
  return `
    <div class="backup-management-table-wrap">
      <table class="backup-management-table">
        <thead>
          <tr>
            <th>Host</th><th>State</th><th>Destination / repo</th><th>Last run</th><th>Rollout/check status</th><th>Links</th>
          </tr>
        </thead>
        <tbody>
          ${hosts.map(host => {
            const live = backupForHost(liveBackupData, host.name);
            const state = statesByHost[host.name];
            const rollout = host.rollout_status || {};
            const destination = host.destination_labels?.join(', ') || (host.enabled ? 'unknown' : 'disabled/planned');
            return `
              <tr>
                <th>
                  <strong>${escapeHtml(host.name)}</strong>
                  <span>${escapeHtml(host.backup_role || host.description || 'role unknown')}</span>
                </th>
                <td><span class="backup-mgmt-pill backup-${escapeHtml(state.color)}">${escapeHtml(state.label)}</span><small>${escapeHtml(state.reason)}</small></td>
                <td><strong>${escapeHtml(destination)}</strong><span>${escapeHtml(host.repository_path || 'repository path unknown')}</span></td>
                <td><strong>${escapeHtml(humanDuration(live?.ageSeconds))} ago</strong><span>duration ${escapeHtml(humanDuration(live?.durationSeconds))} · repo ${live?.repositoryReachable === 1 ? 'reachable' : live?.repositoryReachable === 0 ? 'unreachable' : 'unknown'}</span></td>
                <td>${Object.entries(rollout).length ? Object.entries(rollout).map(([key, value]) => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(String(value))}</span>`).join('') : '<span class="muted">rollout status unknown</span>'}</td>
                <td class="backup-link-cell">
                  <a href="${escapeHtml(host.links?.grafana || '#')}" target="_blank" rel="noopener">Grafana</a>
                  <a href="${escapeHtml(host.links?.alertmanager || '#')}" target="_blank" rel="noopener">Alerts</a>
                  ${formatLink(host.links?.restore_runbook_index, 'Runbook')}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHostBreakdown(data) {
  return `
    <div class="backup-host-breakdown">
      ${(data?.hosts || []).map(host => `
        <article class="backup-host-card backup-${host.enabled ? 'green' : 'grey'}">
          <div class="backup-card-head">
            <strong>${escapeHtml(host.name)}</strong>
            <span class="backup-status-pill backup-${host.enabled ? 'green' : 'grey'}">${host.enabled ? 'enabled' : 'disabled/planned'}</span>
          </div>
          <dl>
            <dt>Important paths</dt><dd>${formatList(host.important_paths, 'no important paths recorded')}</dd>
            <dt>Destinations</dt><dd>${escapeHtml((host.destination_labels || []).join(', ') || 'none enabled')}</dd>
            <dt>Backup sets</dt><dd>${escapeHtml(String(host.backup_sets?.length || 0))}</dd>
          </dl>
          <div class="backup-set-list">
            ${(host.backup_sets || []).map(set => `
              <section>
                <h4>${escapeHtml(set.id)} <span>${escapeHtml(set.type || 'unknown')}</span></h4>
                <p><strong>${escapeHtml(set.backup_class?.name || 'unknown')}</strong> · priority ${escapeHtml(set.backup_class?.restore_priority || 'unknown')}</p>
                <div class="backup-path-columns">
                  <div><em>Included/source paths</em>${formatList(set.paths, 'no paths recorded')}</div>
                  <div><em>Class excludes</em>${formatList(set.backup_class?.excludes, 'no excludes recorded')}</div>
                </div>
                <p class="muted">${escapeHtml(set.restore_metadata?.restore_scope || set.backup_class?.description || 'restore scope not recorded')}</p>
                ${set.restore_runbook ? `<p>${formatLink(set.restore_runbook, 'Restore runbook')}</p>` : ''}
              </section>
            `).join('')}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderServiceReadiness(data) {
  const services = (data?.services || []).filter(service => service.status !== 'retired-cleaned');
  const important = services
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)))
    .slice(0, 16);
  return `
    <div class="backup-management-table-wrap compact">
      <table class="backup-management-table">
        <thead><tr><th>Service</th><th>Hosts</th><th>Backup class</th><th>Priority</th><th>Restore/source note</th></tr></thead>
        <tbody>
          ${important.map(service => `
            <tr>
              <th><strong>${escapeHtml(service.display_name)}</strong><span>${escapeHtml(service.status || 'unknown')}</span></th>
              <td>${escapeHtml((service.hosts || []).join(', ') || 'unknown')}</td>
              <td>${escapeHtml(service.backup_class?.name || 'unknown')}</td>
              <td><span class="pill ${service.backup_class?.restore_priority === 'critical' ? 'warn' : ''}">${escapeHtml(service.backup_class?.restore_priority || 'unknown')}</span></td>
              <td>${escapeHtml(service.restore_note || (service.source_metadata_status === 'present' ? `source metadata: ${service.source_type || 'present'}` : 'dedicated restore runbook not recorded'))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="muted">Showing first ${escapeHtml(String(important.length))} active/planned services. Missing service-specific runbooks remain an amber documentation gap, not a green state.</p>
    </div>
  `;
}

export function renderBackupManagementView(data, liveBackupData, alerts) {
  if (!data) {
    return '<p class="muted">Backup Management data unavailable. Unknown is not healthy; rerun just backup-management-render and redeploy static data.</p>';
  }
  const statesByHost = {};
  const states = (data.hosts || []).map((host) => {
    const state = liveState(host, liveBackupData, alerts);
    statesByHost[host.name] = state;
    return state;
  });
  return `
    <div class="backup-management-view">
      ${renderSummaryCards(data, states)}
      <div class="backup-management-guidance">
        <strong>Read-only slice:</strong> this view links to monitoring and runbooks only. No add/remove, backup trigger, restore trigger, shell execution, or production-path mutation exists here.
        <span>Coming next: controlled add/remove will propose Git-reviewed <code>inventory/backups.yml</code> patches and rendered diffs only.</span>
      </div>
      <h4>Host backup status and destinations</h4>
      ${renderHostTable(data, liveBackupData, alerts, statesByHost)}
      <h4>Per-host backup sets and path coverage</h4>
      ${renderHostBreakdown(data)}
      <h4>Service restore readiness snapshot</h4>
      ${renderServiceReadiness(data)}
    </div>
  `;
}
