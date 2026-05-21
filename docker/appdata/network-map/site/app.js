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
  const groups = new Map();
  for (const item of items) {
    const key = item.source === 'tailscale' ? 'Tailscale' : titleCase(item.category || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  $('map').innerHTML = [...groups.entries()].sort().map(([group, groupItems]) => `
    <div class="map-group">
      <h3>${escapeHtml(group)} <span class="muted">${groupItems.length}</span></h3>
      <div class="node-list">
        ${groupItems.sort(byName).map(item => `<button class="node ${escapeHtml(item.category || item.source)}" data-ip="${escapeHtml(item.ip)}">${escapeHtml(item.display_name)}</button>`).join('')}
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.node').forEach(el => el.addEventListener('click', () => selectByIp(el.dataset.ip)));
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
    $('detail').textContent = 'Select a device card.';
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
