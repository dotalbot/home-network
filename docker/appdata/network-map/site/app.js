let inventory = null;
let selected = null;

const $ = (id) => document.getElementById(id);

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
  const categories = [...new Set(inventory.lan_devices.map(d => d.category || 'unknown'))].sort();
  const ports = [...new Set(allItems().flatMap(d => d.open_ports || []))].sort((a, b) => a - b);
  $('categoryFilter').innerHTML = '<option value="all">All</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('portFilter').innerHTML = '<option value="all">All</option>' + ports.map(p => `<option value="${p}">${p}</option>`).join('');
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
  ].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function renderMap(items) {
  const lan = items.filter(item => item.source === 'lan').sort(byName);
  const tailnet = items.filter(item => item.source === 'tailscale').sort(byName);
  const management = items.filter(item => item.has_management).sort(byName);
  const topServices = [...items].sort((a, b) => (b.service_count || 0) - (a.service_count || 0)).slice(0, 5);
  const nodes = buildTopologyNodes(lan, tailnet);
  const links = buildTopologyLinks(nodes);

  $('map').innerHTML = `
    <div class="topology-stage" role="region" aria-label="Home network topology map">
      <div class="map-legend">
        <span><i class="legend-dot lan"></i> LAN</span>
        <span><i class="legend-dot tailnet"></i> Tailnet</span>
        <span><i class="legend-dot management"></i> Management</span>
        <span><i class="legend-line"></i> Inferred link</span>
      </div>
      <svg class="link-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="lanLink" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.72" />
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0.28" />
          </linearGradient>
          <linearGradient id="tailnetLink" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.75" />
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.24" />
          </linearGradient>
        </defs>
        ${links.map(link => `<path class="topology-link ${escapeHtml(link.type)}" d="M ${link.from.x} ${link.from.y} C ${link.from.x} ${link.to.y - 70}, ${link.to.x} ${link.from.y + 70}, ${link.to.x} ${link.to.y}" />`).join('')}
      </svg>
      <button class="topology-core internet" data-core="internet" style="left: 50%; top: 8%;">
        <span class="node-icon">☁</span>
        <strong>Internet</strong>
        <em>uplink</em>
      </button>
      <button class="topology-core router" data-core="router" style="left: 50%; top: 27%;">
        <span class="node-icon">⇄</span>
        <strong>LAN gateway</strong>
        <em>${lan.length} LAN devices</em>
      </button>
      <button class="topology-core tailnet" data-core="tailnet" style="left: 50%; top: 77%;">
        <span class="node-icon">◇</span>
        <strong>Tailscale</strong>
        <em>${tailnet.length} peers</em>
      </button>
      ${nodes.map(node => renderTopologyNode(node)).join('')}
    </div>
    <div class="insight-grid">
      <article class="insight-card">
        <h3>LibreNMS-inspired neighbours</h3>
        <p>${management.length} visible management surfaces. Select a node to inspect ports, services, MAC, and notes.</p>
      </article>
      <article class="insight-card">
        <h3>Service-dense nodes</h3>
        <div class="mini-bars">${topServices.map(item => renderMiniBar(item, topServices[0]?.service_count || 1)).join('')}</div>
      </article>
      <article class="insight-card">
        <h3>Discovery confidence</h3>
        <p>${confidenceSummary(items)}</p>
      </article>
    </div>
  `;

  document.querySelectorAll('.topology-node').forEach(el => el.addEventListener('click', () => selectByIp(el.dataset.ip)));
  document.querySelectorAll('.mini-bar').forEach(el => el.addEventListener('click', () => selectByIp(el.dataset.ip)));
  document.querySelectorAll('.topology-core').forEach(el => el.addEventListener('click', () => showCoreDetail(el.dataset.core, items)));
}

function buildTopologyNodes(lan, tailnet) {
  return [
    ...positionGroup(lan, {cx: 500, cy: 315, rx: 395, ry: 160, start: -160, end: -20, type: 'lan'}),
    ...positionGroup(tailnet, {cx: 500, cy: 470, rx: 380, ry: 100, start: 205, end: 335, type: 'tailnet'}),
  ];
}

function positionGroup(items, opts) {
  const span = opts.end - opts.start;
  return items.map((item, index) => {
    const angle = (opts.start + ((index + 0.5) * span / Math.max(items.length, 1))) * Math.PI / 180;
    return {
      item,
      type: opts.type,
      x: Math.round(opts.cx + Math.cos(angle) * opts.rx),
      y: Math.round(opts.cy + Math.sin(angle) * opts.ry),
    };
  });
}

function buildTopologyLinks(nodes) {
  const router = {x: 500, y: 170};
  const tailnetCore = {x: 500, y: 477};
  return nodes.map(node => ({
    from: node.type === 'tailnet' ? tailnetCore : router,
    to: {x: node.x, y: node.y},
    type: node.type,
  }));
}

function renderTopologyNode(node) {
  const item = node.item;
  const classes = ['topology-node', node.type, item.category || 'unknown', item.has_management ? 'management' : ''].join(' ');
  return `
    <button class="${escapeHtml(classes)}" data-ip="${escapeHtml(item.ip)}" style="left: ${node.x / 10}%; top: ${node.y / 6.2}%;">
      <span class="node-icon">${iconFor(item)}</span>
      <strong>${escapeHtml(shortName(item.display_name))}</strong>
      <em>${escapeHtml(item.ip)}</em>
      ${(item.open_ports || []).length ? `<span class="port-badge">${item.open_ports.length} ports</span>` : ''}
    </button>
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

function confidenceSummary(items) {
  const counts = items.reduce((acc, item) => {
    const key = item.confidence || 'observed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort().map(([key, value]) => `${value} ${escapeHtml(key)}`).join(' · ') || 'No devices in current filter.';
}

function iconFor(item) {
  if (item.source === 'tailscale') return '◇';
  if ((item.category || '').includes('server')) return '▣';
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
    <article class="card" data-ip="${escapeHtml(item.ip)}">
      <h3>${escapeHtml(item.display_name)}</h3>
      <div class="muted">${escapeHtml(item.ip)} · ${escapeHtml(item.source)} · ${escapeHtml(item.role || item.name || 'unknown')}</div>
      <div class="meta">
        <span class="pill">${escapeHtml(item.category || 'peer')}</span>
        <span class="pill">${escapeHtml(item.confidence || 'observed')}</span>
        ${item.has_management ? '<span class="pill warn">management</span>' : ''}
      </div>
      <div class="meta">${(item.open_ports || []).map(p => `<span class="pill port">:${p}</span>`).join('') || '<span class="pill">no checked ports open</span>'}</div>
      <p class="muted">${escapeHtml(item.notes || '')}</p>
    </article>
  `).join('') || '<p class="muted">No devices match the current filters.</p>';
  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => selectByIp(el.dataset.ip)));
}

function selectByIp(ip) {
  selected = allItems().find(item => item.ip === ip);
  renderDetail();
}

function renderDetail() {
  if (!selected) {
    $('detail').className = 'detail muted';
    $('detail').textContent = 'Select a map node, insight bar, or inventory card.';
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
      <dt>Ports</dt><dd>${(selected.open_ports || []).map(p => `:${p}`).join(', ') || 'none from checked list'}</dd>
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

function byName(a, b) { return a.display_name.localeCompare(b.display_name, undefined, {numeric: true}); }
function titleCase(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

['search', 'sourceFilter', 'categoryFilter', 'portFilter', 'managementOnly'].forEach(id => $(id).addEventListener('input', render));
$('refreshData').addEventListener('click', loadData);
loadData().catch(err => {
  $('cards').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
});
