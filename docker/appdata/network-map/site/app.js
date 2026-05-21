let inventory = null;
let selected = null;
let topologyNodes = [];
let topologyPositions = {};
let topologyCorePositions = {
  internet: {x: 600, y: 95},
  router: {x: 600, y: 240},
  tailnet: {x: 600, y: 730},
};
let dragState = null;
let popupPosition = null;

const $ = (id) => document.getElementById(id);
const TOPOLOGY = {width: 1200, height: 960};

async function loadData() {
  const response = await fetch(`data/inventory.json?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`Failed to load inventory: ${response.status}`);
  inventory = await response.json();
  selected = null;
  populateFilters();
  render();
}

function allItems() {
  if (!inventory) return [];
  return [...inventory.lan_devices, ...inventory.tailnet_peers];
}

function textFor(item) {
  return JSON.stringify(item).toLowerCase();
}

function filteredItems() {
  const query = $('search').value.trim().toLowerCase();
  const source = $('sourceFilter').value;
  const category = $('categoryFilter').value;
  const port = $('portFilter').value;
  const managementOnly = $('managementOnly').checked;

  return allItems().filter((item) => {
    if (source !== 'all' && item.source !== source) return false;
    if (category !== 'all' && (item.category || 'unknown') !== category) return false;
    if (port !== 'all' && !(item.open_ports || []).includes(Number(port))) return false;
    if (managementOnly && !item.has_management) return false;
    if (query && !textFor(item).includes(query)) return false;
    return true;
  });
}

function populateFilters() {
  const categories = [...new Set(allItems().map(d => d.category || 'unknown'))].sort();
  const ports = [...new Set(allItems().flatMap(d => d.open_ports || []))].sort((a, b) => a - b);
  $('categoryFilter').innerHTML = '<option value="all">All</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('portFilter').innerHTML = '<option value="all">All</option>' + ports.map(p => `<option value="${escapeHtml(String(p))}">${escapeHtml(String(p))}</option>`).join('');
}

function renderSummary(items) {
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

function renderMap(items) {
  const lan = items.filter(item => item.source === 'lan').sort(byName);
  const tailnet = items.filter(item => item.source === 'tailscale').sort(byName);
  const management = items.filter(item => item.has_management).sort(byName);
  const topServices = [...items].sort((a, b) => (b.service_count || 0) - (a.service_count || 0)).slice(0, 8);
  const nodes = buildTopologyNodes(lan, tailnet);
  topologyNodes = nodes;
  ensureTopologyPositions(nodes);

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
          <p class="muted">A compact “what exposes what” view across common ports.</p>
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
}

function renderExpandedTopology(nodes, lanCount, tailnetCount) {
  return `
    <div class="topology-scroll" tabindex="0" aria-label="Scrollable expanded topology canvas">
      <div class="topology-stage" role="region" aria-label="Home network topology map">
        <div class="topology-band lan-band"><span>LAN / 192.168.1.x</span></div>
        <div class="topology-band tailnet-band"><span>Tailscale overlay</span></div>
        <div class="map-legend">
          <span><i class="legend-dot lan"></i> LAN</span>
          <span><i class="legend-dot tailnet"></i> Tailnet</span>
          <span><i class="legend-dot management"></i> Management</span>
          <span><i class="legend-line"></i> Inferred link</span>
        </div>
        <svg class="link-layer" viewBox="0 0 ${TOPOLOGY.width} ${TOPOLOGY.height}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="lanLink" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.62" />
              <stop offset="100%" stop-color="#22c55e" stop-opacity="0.20" />
            </linearGradient>
            <linearGradient id="tailnetLink" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.70" />
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.18" />
            </linearGradient>
          </defs>
          <g id="topologyLinks">${renderTopologyLinks()}</g>
        </svg>
        <button class="topology-core internet" data-core="internet" style="${positionStyle(topologyCorePositions.internet)}">
          <span class="node-icon">☁</span>
          <strong>Internet</strong>
          <em>uplink</em>
        </button>
        <button class="topology-core router" data-core="router" style="${positionStyle(topologyCorePositions.router)}">
          <span class="node-icon">⇄</span>
          <strong>LAN gateway</strong>
          <em>${lanCount} LAN devices</em>
        </button>
        <button class="topology-core tailnet" data-core="tailnet" style="${positionStyle(topologyCorePositions.tailnet)}">
          <span class="node-icon">◇</span>
          <strong>Tailscale</strong>
          <em>${tailnetCount} peers</em>
        </button>
        ${nodes.map(node => renderTopologyNode(node)).join('')}
        <aside id="topologyPopup" class="topology-detail-popover hidden" aria-live="polite"></aside>
      </div>
    </div>
  `;
}


function ensureTopologyPositions(nodes) {
  nodes.forEach((node) => {
    const key = node.item.ip;
    if (!topologyPositions[key]) topologyPositions[key] = {x: node.x, y: node.y};
  });
}

function positionStyle(pos) {
  return `left: ${(pos.x / TOPOLOGY.width) * 100}%; top: ${(pos.y / TOPOLOGY.height) * 100}%;`;
}

function renderTopologyLinks() {
  return [
    `<path class="backbone-link" d="${linkPath({from: topologyCorePositions.internet, to: topologyCorePositions.router})}" />`,
    `<path class="backbone-link tailnet" d="${linkPath({from: topologyCorePositions.router, to: topologyCorePositions.tailnet})}" />`,
    ...topologyNodes.map((node) => {
      const from = node.type === 'tailnet' ? topologyCorePositions.tailnet : topologyCorePositions.router;
      const to = topologyPositions[node.item.ip] || {x: node.x, y: node.y};
      return `<path class="topology-link ${escapeHtml(node.type)}" d="${linkPath({from, to})}" />`;
    }),
  ].join('');
}

function redrawTopologyLinks() {
  const layer = $('topologyLinks');
  if (layer) layer.innerHTML = renderTopologyLinks();
}

function buildTopologyNodes(lan, tailnet) {
  const lanSorted = [...lan].sort((a, b) => categoryRank(a) - categoryRank(b) || byName(a, b));
  return [
    ...positionLaneGroup(lanSorted, {columns: [95, 250, 405, 795, 950, 1105], top: 330, rowGap: 82, type: 'lan'}),
    ...positionLaneGroup(tailnet, {columns: [190, 395, 600, 805, 1010], top: 830, rowGap: 74, type: 'tailnet'}),
  ];
}

function positionLaneGroup(items, opts) {
  return items.map((item, index) => {
    const colIndex = index % opts.columns.length;
    const rowIndex = Math.floor(index / opts.columns.length);
    const isRightSide = opts.columns[colIndex] > TOPOLOGY.width / 2;
    return {
      item,
      type: opts.type,
      x: opts.columns[colIndex],
      y: opts.top + (rowIndex * opts.rowGap) + ((isRightSide && opts.type === 'lan') ? 24 : 0),
    };
  });
}

function buildTopologyLinks(nodes) {
  const router = {x: 600, y: 245};
  const tailnetCore = {x: 600, y: 700};
  return nodes.map(node => ({
    from: node.type === 'tailnet' ? tailnetCore : router,
    to: {x: node.x, y: node.y},
    type: node.type,
  }));
}

function linkPath(link) {
  const bend = link.to.x < link.from.x ? -70 : 70;
  return `M ${link.from.x} ${link.from.y} C ${link.from.x + bend} ${link.from.y + 90}, ${link.to.x - bend} ${link.to.y - 70}, ${link.to.x} ${link.to.y}`;
}

function renderTopologyNode(node) {
  const item = node.item;
  const classes = ['topology-node', node.type, item.category || 'unknown', item.has_management ? 'management' : ''].join(' ');
  return `
    <button class="${escapeHtml(classes)}" data-ip="${escapeHtml(item.ip)}" style="${positionStyle(topologyPositions[item.ip] || node)}">
      <span class="node-icon">${iconFor(item)}</span>
      <strong>${escapeHtml(shortName(item.display_name))}</strong>
      <em>${escapeHtml(item.ip)}</em>
      ${(item.open_ports || []).length ? `<span class="port-badge">${item.open_ports.length} ports</span>` : ''}
    </button>
  `;
}

function renderZoneLanes(items) {
  const lanes = [
    ['LAN devices', items.filter(item => item.source === 'lan')],
    ['Tailnet peers', items.filter(item => item.source === 'tailscale')],
    ['Management surfaces', items.filter(item => item.has_management)],
    ['Needs discovery', items.filter(item => (item.confidence || '') !== 'high' || ['unknown', undefined, null].includes(item.category))],
  ];
  return `<div class="zone-lanes">${lanes.map(([title, laneItems]) => `
    <section class="zone-lane">
      <h4>${escapeHtml(title)} <span>${laneItems.length}</span></h4>
      <div>${laneItems.sort(byName).map(renderDeviceChip).join('') || '<p class="muted empty">No matching devices.</p>'}</div>
    </section>
  `).join('')}</div>`;
}

function renderDeviceChip(item) {
  return `
    <button class="device-chip ${item.has_management ? 'management' : ''}" data-ip="${escapeHtml(item.ip)}">
      <span>${iconFor(item)}</span>
      <strong>${escapeHtml(shortName(item.display_name))}</strong>
      <em>${escapeHtml(item.ip)}</em>
    </button>
  `;
}

function renderServiceMatrix(items) {
  const ports = [...new Set(items.flatMap(item => item.open_ports || []))].sort((a, b) => a - b).slice(0, 8);
  if (!items.length) return '<p class="muted">No devices match the current filters.</p>';
  if (!ports.length) return '<p class="muted">No checked ports are open in the current filter.</p>';
  return `
    <div class="matrix-scroll">
      <table class="service-matrix">
        <thead><tr><th>Device</th>${ports.map(port => `<th>:${escapeHtml(String(port))}</th>`).join('')}</tr></thead>
        <tbody>
          ${items.sort((a, b) => (b.service_count || 0) - (a.service_count || 0) || byName(a, b)).slice(0, 18).map(item => `
            <tr>
              <th><button class="matrix-device" data-ip="${escapeHtml(item.ip)}">${escapeHtml(shortName(item.display_name))}<span>${escapeHtml(item.ip)}</span></button></th>
              ${ports.map(port => `<td>${(item.open_ports || []).includes(port) ? '<span class="matrix-hit">●</span>' : '<span class="matrix-empty">—</span>'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOperationsBoard(items, management, topServices) {
  const confidence = confidenceBreakdown(items);
  return `
    <div class="ops-board">
      <article class="ops-panel">
        <h4>Management surfaces</h4>
        <p class="muted">${management.length} visible nodes with web/SSH/admin-style exposure.</p>
        <div class="ops-list">${management.slice(0, 10).map(renderDeviceChip).join('') || '<p class="muted empty">No management surfaces in filter.</p>'}</div>
      </article>
      <article class="ops-panel">
        <h4>Service-dense nodes</h4>
        <div class="mini-bars">${topServices.map(item => renderMiniBar(item, topServices[0]?.service_count || 1)).join('') || '<p class="muted empty">No services in filter.</p>'}</div>
      </article>
      <article class="ops-panel">
        <h4>Discovery confidence</h4>
        <div class="confidence-stack">${confidence.map(([key, value]) => `<span><strong>${value}</strong>${escapeHtml(key)}</span>`).join('') || '<p class="muted empty">No devices in filter.</p>'}</div>
        <p class="muted">Use this to decide what needs hostname, owner, or service enrichment next.</p>
      </article>
    </div>
  `;
}

function renderMiniBar(item, max) {
  const width = Math.max(8, Math.round(((item.service_count || 0) / Math.max(max, 1)) * 100));
  return `
    <button class="mini-bar" data-ip="${escapeHtml(item.ip)}">
      <span>${escapeHtml(shortName(item.display_name))}</span>
      <i style="width:${width}%"></i>
      <em>${item.service_count || 0}</em>
    </button>
  `;
}


function bindTopologyInteractions(items) {
  document.querySelectorAll('.topology-node').forEach((el) => {
    makeDraggable(el, 'node');
    el.addEventListener('click', (event) => {
      if (el.dataset.suppressClick === 'true') return;
      event.stopPropagation();
      selectByIp(el.dataset.ip);
      showTopologyDevicePopup(selected, el);
    });
  });
  document.querySelectorAll('.topology-core').forEach((el) => {
    makeDraggable(el, 'core');
    el.addEventListener('click', (event) => {
      if (el.dataset.suppressClick === 'true') return;
      event.stopPropagation();
      showCoreDetail(el.dataset.core, items);
      showTopologyCorePopup(el.dataset.core, items, el);
    });
  });
  const stage = document.querySelector('.topology-stage');
  if (stage) stage.addEventListener('click', (event) => {
    if (event.target === stage) closeTopologyPopup();
  });
}

function makeDraggable(el, kind) {
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const stage = el.closest('.topology-stage');
    const rect = stage.getBoundingClientRect();
    const key = kind === 'core' ? el.dataset.core : el.dataset.ip;
    const source = kind === 'core' ? topologyCorePositions : topologyPositions;
    const start = source[key];
    dragState = {
      el,
      kind,
      key,
      rect,
      startX: start.x,
      startY: start.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
      moved: false,
    };
    el.setPointerCapture(event.pointerId);
    el.classList.add('dragging');
    event.preventDefault();
  });
  el.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.el !== el) return;
    const dx = ((event.clientX - dragState.pointerX) / dragState.rect.width) * TOPOLOGY.width;
    const dy = ((event.clientY - dragState.pointerY) / dragState.rect.height) * TOPOLOGY.height;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.moved = true;
    const pos = {
      x: clamp(dragState.startX + dx, 45, TOPOLOGY.width - 45),
      y: clamp(dragState.startY + dy, 45, TOPOLOGY.height - 45),
    };
    if (dragState.kind === 'core') topologyCorePositions[dragState.key] = pos;
    else topologyPositions[dragState.key] = pos;
    el.style.left = `${(pos.x / TOPOLOGY.width) * 100}%`;
    el.style.top = `${(pos.y / TOPOLOGY.height) * 100}%`;
    redrawTopologyLinks();
  });
  el.addEventListener('pointerup', (event) => {
    if (!dragState || dragState.el !== el) return;
    el.releasePointerCapture(event.pointerId);
    el.classList.remove('dragging');
    if (dragState.moved) {
      el.dataset.suppressClick = 'true';
      window.setTimeout(() => { el.dataset.suppressClick = 'false'; }, 120);
    }
    dragState = null;
  });
}

function showTopologyDevicePopup(item, anchor) {
  if (!item) return;
  const services = item.services || [];
  showTopologyPopup(`
    <div class="popover-titlebar">
      <strong>${escapeHtml(item.display_name)}</strong>
      <button class="popover-close" type="button" aria-label="Close properties">×</button>
    </div>
    <dl>
      <dt>IP</dt><dd>${escapeHtml(item.ip)}</dd>
      <dt>Source</dt><dd>${escapeHtml(item.source)}</dd>
      <dt>Role</dt><dd>${escapeHtml(item.role || item.name || 'unknown')}</dd>
      <dt>Category</dt><dd>${escapeHtml(item.category || 'peer')}</dd>
      <dt>MAC</dt><dd>${escapeHtml(item.mac || 'n/a')}</dd>
      <dt>Ports</dt><dd>${(item.open_ports || []).map(p => `:${escapeHtml(String(p))}`).join(', ') || 'none from checked list'}</dd>
      <dt>Confidence</dt><dd>${escapeHtml(item.confidence || 'observed')}</dd>
      <dt>Notes</dt><dd>${escapeHtml(item.notes || '')}</dd>
    </dl>
    ${services.length ? `<h4>Services</h4><ul class="services">${services.map(s => `<li>${escapeHtml(s.name || 'service')} · ${escapeHtml(String(s.protocol || 'tcp'))} · :${escapeHtml(String(s.port || ''))}</li>`).join('')}</ul>` : ''}
  `, anchor);
}

function showTopologyCorePopup(core, items, anchor) {
  const copy = {
    internet: ['Internet uplink', 'Conceptual edge node. Add router telemetry later for WAN status, latency, and throughput.'],
    router: ['LAN gateway', `${items.filter(i => i.source === 'lan').length} LAN devices currently visible in the filtered view. Future LLDP/CDP/SNMP data can replace inferred links with real neighbours.`],
    tailnet: ['Tailscale overlay', `${items.filter(i => i.source === 'tailscale').length} Tailnet peers currently visible in the filtered view.`],
  }[core];
  showTopologyPopup(`
    <div class="popover-titlebar">
      <strong>${escapeHtml(copy[0])}</strong>
      <button class="popover-close" type="button" aria-label="Close properties">×</button>
    </div>
    <p>${escapeHtml(copy[1])}</p>
  `, anchor);
}

function showTopologyPopup(content, anchor) {
  const popup = $('topologyPopup');
  if (!popup) return;
  popup.classList.remove('hidden');
  popup.innerHTML = content;
  if (!popupPosition && anchor) {
    popup.style.left = '';
    popup.style.top = '18px';
    popup.style.right = '18px';
  }
  popup.querySelector('.popover-close')?.addEventListener('click', closeTopologyPopup);
  makePopupDraggable(popup);
}

function closeTopologyPopup() {
  const popup = $('topologyPopup');
  if (!popup) return;
  popup.classList.add('hidden');
  popup.innerHTML = '';
}

function makePopupDraggable(popup) {
  const handle = popup.querySelector('.popover-titlebar');
  if (!handle) return;
  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.popover-close')) return;
    const stageRect = popup.closest('.topology-stage').getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const startLeft = popupRect.left - stageRect.left;
    const startTop = popupRect.top - stageRect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    popup.setPointerCapture(event.pointerId);
    popup.classList.add('dragging');
    const move = (moveEvent) => {
      const left = clamp(startLeft + moveEvent.clientX - startX, 12, stageRect.width - popupRect.width - 12);
      const top = clamp(startTop + moveEvent.clientY - startY, 12, stageRect.height - popupRect.height - 12);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.right = 'auto';
      popupPosition = {left, top};
    };
    const up = (upEvent) => {
      popup.releasePointerCapture(upEvent.pointerId);
      popup.classList.remove('dragging');
      popup.removeEventListener('pointermove', move);
      popup.removeEventListener('pointerup', up);
    };
    popup.addEventListener('pointermove', move);
    popup.addEventListener('pointerup', up);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showCoreDetail(core, items) {
  const copy = {
    internet: {
      title: 'Internet uplink',
      body: 'Conceptual edge node. Add router telemetry later for WAN status, latency, and throughput.',
    },
    router: {
      title: 'LAN gateway',
      body: `${items.filter(i => i.source === 'lan').length} LAN devices currently visible in the filtered view. Future LLDP/CDP/SNMP data can replace inferred links with real neighbours.`,
    },
    tailnet: {
      title: 'Tailscale overlay',
      body: `${items.filter(i => i.source === 'tailscale').length} Tailnet peers currently visible in the filtered view.`,
    },
  }[core];
  selected = null;
  $('detail').className = 'detail';
  $('detail').innerHTML = `<h3>${escapeHtml(copy.title)}</h3><p>${escapeHtml(copy.body)}</p>`;
}

function confidenceBreakdown(items) {
  const counts = items.reduce((acc, item) => {
    const key = item.confidence || 'observed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort();
}

function categoryRank(item) {
  const rank = {server: 0, network: 1, server_or_client: 2, iot: 3, client: 4, unknown: 5};
  return rank[item.category || 'unknown'] ?? 9;
}

function iconFor(item) {
  if (item.source === 'tailscale') return '◇';
  if ((item.category || '').includes('server')) return '▣';
  if ((item.category || '').includes('network')) return '⇄';
  if ((item.category || '').includes('iot')) return '◌';
  if ((item.category || '').includes('client')) return '▢';
  if (item.has_management) return '◆';
  return '●';
}

function shortName(name) {
  return String(name || 'unknown').replace(/\.lan$|\.local$/i, '').slice(0, 24);
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
  `;
}

function render() {
  const items = filteredItems();
  renderSummary(items);
  renderMap(items);
  renderCards(items);
  renderDetail();
}

function byName(a, b) { return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, {numeric: true}); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

['search', 'sourceFilter', 'categoryFilter', 'portFilter', 'managementOnly'].forEach(id => $(id).addEventListener('input', render));
$('refreshData').addEventListener('click', loadData);
loadData().catch(err => {
  $('cards').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
});
