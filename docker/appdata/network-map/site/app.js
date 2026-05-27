/**
 * Network Map — ES module entry point.
 * Imports from ./modules/ and orchestrates the dashboard.
 */
import { $, escapeHtml, byName, iconFor, shortName, categoryRank } from './modules/utils.js';
import { setInventory, getInventory, allItems, filteredItems, populateFilters } from './modules/filters.js';
import {
  TOPOLOGY,
  topologyNodes,
  topologyPositions,
  topologyCorePositions,
  renderExpandedTopology,
  buildTopologyNodes,
  ensureTopologyPositions,
  redrawTopologyLinks,
  renderZoneLanes,
  renderServiceMatrix,
  renderOperationsBoard,
  bindTopologyInteractions,
} from './modules/topology.js';
import { fetchHealthData } from './modules/api.js';
import { attachHealthToNodes, findHealthForItem, renderHealthDetail } from './modules/node-health.js';

let selected = null;
let currentHealthData = null;
let healthRefreshTimer = null;

// ---- Data loading ----

async function loadData() {
  const response = await fetch(`data/inventory.json?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`Failed to load inventory: ${response.status}`);
  const inventory = await response.json();
  setInventory(inventory);
  selected = null;
  populateFilters();
  render();
}

// ---- Summary ----

function renderSummary(items) {
  const inventory = getInventory();
  const summary = inventory.summary;
  const sourceCounts = items.reduce((acc, item) => { acc[item.source] = (acc[item.source] || 0) + 1; return acc; }, {});
  $('summary').innerHTML = [
    ['LAN devices', summary.lan_devices],
    ['Tailnet peers', summary.tailnet_peers],
    ['Visible now', items.length],
    ['Management surfaces', items.filter(i => i.has_management).length],
    ['LAN shown', sourceCounts.lan || 0],
    ['Tailscale shown', sourceCounts.tailscale || 0],
  ].map(([label, value]) => `<div class="stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

// ---- Main render ----

function renderMap(items) {
  const lan = items.filter(item => item.source === 'lan').sort(byName);
  const tailnet = items.filter(item => item.source === 'tailscale').sort(byName);
  const management = items.filter(item => item.has_management).sort(byName);
  const topServices = [...items].sort((a, b) => (b.service_count || 0) - (a.service_count || 0)).slice(0, 8);
  const nodes = buildTopologyNodes(lan, tailnet);

  // Update module-level topology state
  // topologyNodes is imported as a live binding; we need to rewrite it
  // Topology module manages its own state now

  $('map').innerHTML = `
    <section class="option-card option-topology" aria-labelledby="topology-title">
      <div class="option-heading">
        <div>
          <p class="eyebrow small">Option 1 · improved current graph</p>
          <h3 id="topology-title">Expanded topology</h3>
        </div>
        <p class="muted">Drag nodes to organise the map, then click any node for a movable properties pop-up. Links are still inferred from inventory, not live LLDP/SNMP.</p>
      </div>
      ${renderExpandedTopology(nodes, lan.length, tailnet.length)}
    </section>

    <section class="option-grid">
      <article class="option-card" aria-labelledby="lanes-title">
        <div class="option-heading compact">
          <div>
            <p class="eyebrow small">Option 2</p>
            <h3 id="lanes-title">Zone lanes</h3>
          </div>
          <p class="muted">Grouped swimlanes for quick scanning by network zone and operational attention.</p>
        </div>
        ${renderZoneLanes(items)}
      </article>

      <article class="option-card" aria-labelledby="matrix-title">
        <div class="option-heading compact">
          <div>
            <p class="eyebrow small">Option 3</p>
            <h3 id="matrix-title">Service matrix</h3>
          </div>
          <p class="muted">A compact "what exposes what" view across common ports.</p>
        </div>
        ${renderServiceMatrix(items)}
      </article>
    </section>

    <section class="option-card" aria-labelledby="ops-title">
      <div class="option-heading">
        <div>
          <p class="eyebrow small">Option 4</p>
          <h3 id="ops-title">Operations board</h3>
        </div>
        <p class="muted">Prioritised cards for management surfaces, service-dense hosts, and discovery confidence.</p>
      </div>
      ${renderOperationsBoard(items, management, topServices)}
    </section>
  `;

  bindDeviceClicks();
  bindTopologyInteractions(items);

  // Attach health badges after topology nodes are rendered
  if (currentHealthData) {
    attachHealthToNodes(currentHealthData, allItems());
  }
}

function bindDeviceClicks() {
  document.querySelectorAll('[data-ip]').forEach((el) => {
    if (el.classList.contains('topology-node')) return;
    el.addEventListener('click', () => selectByIp(el.dataset.ip));
  });
}

function selectByIp(ip) {
  selected = allItems().find(item => item.ip === ip);
  renderDetail();
}

function renderDetail() {
  if (!selected) {
    $('detail').className = 'detail muted';
    $('detail').textContent = 'Select a map node, service entry, insight bar, or inventory card.';
    return;
  }
  $('detail').className = 'detail';
  const services = selected.services || [];
  const hostHealth = findHealthForItem(currentHealthData, selected);
  $('detail').innerHTML = `
    <h3>${escapeHtml(selected.display_name)}</h3>
    <dl>
      <dt>IP</dt><dd>${escapeHtml(selected.ip)}</dd>
      <dt>Source</dt><dd>${escapeHtml(selected.source)}</dd>
      <dt>Role</dt><dd>${escapeHtml(selected.role || selected.name || 'unknown')}</dd>
      <dt>Category</dt><dd>${escapeHtml(selected.category || 'peer')}</dd>
      <dt>MAC</dt><dd>${escapeHtml(selected.mac || 'n/a')}</dd>
      <dt>Ports</dt><dd>${(selected.open_ports || []).map(p => `:${escapeHtml(String(p))}`).join(', ') || 'none from checked list'}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(selected.confidence || 'observed')}</dd>
      <dt>Notes</dt><dd>${escapeHtml(selected.notes || '')}</dd>
    </dl>
    ${services.length ? `<h4>Services</h4><ul class="services">${services.map(s => `<li>${escapeHtml(s.name || 'service')} · ${escapeHtml(String(s.protocol || 'tcp'))} · :${escapeHtml(String(s.port || ''))}</li>`).join('')}</ul>` : ''}
    ${hostHealth ? renderHealthDetail(hostHealth) : ''}
  `;
}

function renderCards(items) {
  $('cards').innerHTML = items.sort(byName).map(item => `
    <article class="card" data-ip="${escapeHtml(item.ip)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.display_name)}">
      <h3>${escapeHtml(item.display_name)}</h3>
      <div class="muted">${escapeHtml(item.ip)} · ${escapeHtml(item.source)} · ${escapeHtml(item.role || item.name || 'unknown')}</div>
      <div class="meta">
        <span class="pill">${escapeHtml(item.category || 'peer')}</span>
        <span class="pill">${escapeHtml(item.confidence || 'observed')}</span>
        ${item.has_management ? '<span class="pill warn">management</span>' : ''}
      </div>
      <div class="meta">${(item.open_ports || []).map(p => `<span class="pill port">:${escapeHtml(String(p))}</span>`).join('') || '<span class="pill">no checked ports open</span>'}</div>
      <p class="muted">${escapeHtml(item.notes || '')}</p>
    </article>
  `).join('') || '<p class="muted">No devices match the current filters.</p>';
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => selectByIp(el.dataset.ip));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectByIp(el.dataset.ip);
      }
    });
  });
}

function render() {
  const items = filteredItems();
  renderSummary(items);
  renderMap(items);
  renderCards(items);
  renderDetail();
}

// ---- Health data refresh ----

function updateHealthTimestamp() {
  const el = document.getElementById('healthTimestamp');
  if (!el) return;
  if (!currentHealthData || !currentHealthData.timestamp) {
    el.textContent = 'Health data: unavailable';
    return;
  }
  const date = new Date(currentHealthData.timestamp);
  const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const hostCount = Object.keys(currentHealthData).filter(k => k !== 'timestamp').length;
  el.textContent = `Health data: ${hostCount} nodes · updated ${timeStr}`;
}

async function refreshHealthData() {
  try {
    currentHealthData = await fetchHealthData();
  } catch (err) {
    console.warn('[app] Health data fetch failed:', err);
    currentHealthData = null;
  }
  updateHealthTimestamp();
  // Re-attach health badges if topology is already rendered
  if (currentHealthData) {
    attachHealthToNodes(currentHealthData, allItems());
  }
}

function startHealthRefresh() {
  if (healthRefreshTimer) clearInterval(healthRefreshTimer);
  healthRefreshTimer = setInterval(refreshHealthData, 60000);
}

function stopHealthRefresh() {
  if (healthRefreshTimer) {
    clearInterval(healthRefreshTimer);
    healthRefreshTimer = null;
  }
}

// Pause/resume health refresh based on tab visibility
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopHealthRefresh();
  } else {
    refreshHealthData();
    startHealthRefresh();
  }
});

// ---- Topology node popup health enrichment ----
// Listen for custom event from topology module when a device popup is shown
document.addEventListener('topologynodepopup', (event) => {
  const {item} = event.detail;
  if (!item || !currentHealthData) return;
  const hostHealth = findHealthForItem(currentHealthData, item);
  if (!hostHealth) return;
  const detailEl = document.getElementById('healthDetail');
  if (detailEl) {
    detailEl.innerHTML = renderHealthDetail(hostHealth);
  }
});

// ---- Initialize ----

['search', 'sourceFilter', 'categoryFilter', 'portFilter', 'managementOnly'].forEach(id => $(id).addEventListener('input', render));
$('refreshData').addEventListener('click', loadData);

Promise.all([loadData(), refreshHealthData()]).catch(err => {
  $('cards').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
});

startHealthRefresh();