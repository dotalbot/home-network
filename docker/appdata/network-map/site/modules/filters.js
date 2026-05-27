/**
 * Filter utilities for the Network Map dashboard.
 */
import { $, escapeHtml } from './utils.js';

let inventory = null;

export function setInventory(inv) {
  inventory = inv;
}

export function getInventory() {
  return inventory;
}

export function allItems() {
  if (!inventory) return [];
  return [...inventory.lan_devices, ...inventory.tailnet_peers];
}

export function textFor(item) {
  return JSON.stringify(item).toLowerCase();
}

export function filteredItems() {
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

export function populateFilters() {
  const categories = [...new Set(allItems().map(d => d.category || 'unknown'))].sort();
  const ports = [...new Set(allItems().flatMap(d => d.open_ports || []))].sort((a, b) => a - b);
  $('categoryFilter').innerHTML = '<option value="all">All</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('portFilter').innerHTML = '<option value="all">All</option>' + ports.map(p => `<option value="${escapeHtml(String(p))}">${escapeHtml(String(p))}</option>`).join('');
}