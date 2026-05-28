/**
 * Drill-down link and iframe helpers for Grafana/Dozzle/Portainer/Alertmanager.
 */
import { escapeHtml } from './utils.js';

const BASE = {
  grafana: 'http://192.168.1.2:3001',
  dozzle: 'http://192.168.1.1:8080',
  portainer: 'https://192.168.1.1:9443',
  alertmanager: 'http://192.168.1.2:9093',
  prometheus: 'http://192.168.1.2:9090',
};

function normalizedHost(item) {
  return String(item?.name || item?.hostname || item?.display_name || '')
    .replace(/\.lan$|\.local$|\.cheetah-iwato\.ts\.net$/i, '')
    .replace(/^host\.docker\.internal$/, 'jellybase');
}

function promHost(item) {
  const host = normalizedHost(item);
  if (host === '192.168.1.2') return 'jellybase';
  if (host === '192.168.1.1') return 'jellyhome';
  return host;
}

export function drilldownLinks(item) {
  const host = promHost(item);
  const hostParam = encodeURIComponent(host || '.*');
  const alertFilter = encodeURIComponent(`monitored_host="${host}"`);
  const promQuery = encodeURIComponent(`up{monitored_host="${host}"} or up{instance=~"${host}(:.*)?"}`);
  return [
    {
      id: 'grafana-host',
      label: 'Grafana host',
      url: `${BASE.grafana}/d/host-observability/host-observability?orgId=1&var-host=${hostParam}&from=now-6h&to=now&kiosk`,
    },
    {
      id: 'grafana-backups',
      label: 'Grafana backups',
      url: `${BASE.grafana}/d/borgmatic-backups/borgmatic-backups?orgId=1&var-host=${hostParam}&from=now-7d&to=now&kiosk`,
    },
    {
      id: 'prometheus',
      label: 'Prometheus query',
      url: `${BASE.prometheus}/graph?g0.expr=${promQuery}&g0.tab=1`,
    },
    {
      id: 'alertmanager',
      label: 'Alertmanager',
      url: `${BASE.alertmanager}/#/alerts?filter=${alertFilter}`,
    },
    {
      id: 'dozzle',
      label: 'Dozzle logs',
      url: BASE.dozzle,
    },
    {
      id: 'portainer',
      label: 'Portainer',
      url: BASE.portainer,
    },
  ];
}

export function renderDrilldownLinks(item) {
  if (!item) return '';
  return `
    <div class="drilldown-links">
      <h4>Drill-down</h4>
      <div class="drilldown-button-row">
        ${drilldownLinks(item).map(link => `
          <button type="button" class="drilldown-button" data-drilldown-url="${escapeHtml(link.url)}" data-drilldown-title="${escapeHtml(link.label)}">${escapeHtml(link.label)}</button>
        `).join('')}
      </div>
    </div>
  `;
}
