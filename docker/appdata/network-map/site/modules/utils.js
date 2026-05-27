/**
 * Shared utilities for the Network Map dashboard.
 */

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function shortName(name) {
  return String(name || 'unknown').replace(/\.lan$|\.local$/i, '').slice(0, 24);
}

export function byName(a, b) {
  return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, {numeric: true});
}

export function categoryRank(item) {
  const rank = {server: 0, network: 1, server_or_client: 2, iot: 3, client: 4, unknown: 5};
  return rank[item.category || 'unknown'] ?? 9;
}

export function iconFor(item) {
  if (item.source === 'tailscale') return '◇';
  if ((item.category || '').includes('server')) return '▣';
  if ((item.category || '').includes('network')) return '⇄';
  if ((item.category || '').includes('iot')) return '◌';
  if ((item.category || '').includes('client')) return '▢';
  if (item.has_management) return '◆';
  return '●';
}