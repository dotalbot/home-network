/**
 * Backup status rendering for borgmatic metrics exported via node_exporter textfile collector.
 */
import { escapeHtml, shortName } from './utils.js';

const STALE_AFTER_SECONDS = 36 * 60 * 60;

function statusClass(backup) {
  if (!backup) return 'grey';
  if (backup.repositoryReachable === 0 || backup.success === 0 || (backup.exitCode !== undefined && backup.exitCode !== 0)) return 'red';
  if (backup.ageSeconds !== undefined && backup.ageSeconds > STALE_AFTER_SECONDS) return 'amber';
  if (backup.success === 1) return 'green';
  return 'grey';
}

function statusLabel(backup) {
  const color = statusClass(backup);
  if (color === 'green') return 'OK';
  if (color === 'amber') return 'Stale';
  if (color === 'red') return 'Failed';
  return 'No data';
}

function humanDuration(seconds) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  const value = Number(seconds);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  if (value < 86400) return `${Math.round(value / 3600)}h`;
  return `${Math.round(value / 86400)}d`;
}

function humanAgo(seconds) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  return `${humanDuration(seconds)} ago`;
}

function formatDate(seconds) {
  if (!seconds || Number.isNaN(seconds)) return 'n/a';
  return new Date(Number(seconds) * 1000).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatArchive(backup) {
  return backup?.archiveName || 'n/a';
}

export function backupBadgeClass(backup) {
  return statusClass(backup);
}

export function renderBackupDetail(backup) {
  if (!backup) return '';
  const color = statusClass(backup);
  return `
    <div class="backup-detail">
      <h4 class="health-title">Backup status <span class="health-badge-inline health-${color}"></span></h4>
      <dl>
        <dt>Status</dt><dd>${escapeHtml(statusLabel(backup))}</dd>
        <dt>Last run</dt><dd>${escapeHtml(humanAgo(backup.ageSeconds))} (${escapeHtml(formatDate(backup.timestamp))})</dd>
        <dt>Duration</dt><dd>${escapeHtml(humanDuration(backup.durationSeconds))}</dd>
        <dt>Exit code</dt><dd>${backup.exitCode ?? 'n/a'}</dd>
        <dt>Repository</dt><dd>${backup.repositoryReachable === 1 ? 'reachable' : backup.repositoryReachable === 0 ? 'unreachable' : 'n/a'}</dd>
        <dt>Archive</dt><dd>${escapeHtml(formatArchive(backup))}</dd>
      </dl>
    </div>
  `;
}

export function renderBackupStatusPanel(backupData) {
  const hosts = Object.keys(backupData || {})
    .filter(host => host !== 'timestamp')
    .sort();

  if (!hosts.length) {
    return '<p class="muted">No borgmatic metrics available yet.</p>';
  }

  return `
    <div class="backup-grid">
      ${hosts.map(host => {
        const backup = backupData[host];
        const color = statusClass(backup);
        return `
          <article class="backup-card backup-${color}" data-backup-host="${escapeHtml(host)}">
            <div class="backup-card-head">
              <strong>${escapeHtml(shortName(host))}</strong>
              <span class="backup-status-pill backup-${color}">${escapeHtml(statusLabel(backup))}</span>
            </div>
            <dl>
              <dt>Last</dt><dd>${escapeHtml(humanAgo(backup.ageSeconds))}</dd>
              <dt>Duration</dt><dd>${escapeHtml(humanDuration(backup.durationSeconds))}</dd>
              <dt>Repo</dt><dd>${backup.repositoryReachable === 1 ? 'reachable' : backup.repositoryReachable === 0 ? 'unreachable' : 'n/a'}</dd>
              <dt>Archive</dt><dd>${escapeHtml(formatArchive(backup))}</dd>
            </dl>
          </article>
        `;
      }).join('')}
    </div>
  `;
}
