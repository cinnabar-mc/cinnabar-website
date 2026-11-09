(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' ? require('./marketplace-core.js') : root.CinnabarMarket;
  const C = typeof module !== 'undefined' ? require('./marketplace-content.js') : root.CinnabarContent;
  const SORTS = Object.freeze([
    { value: 'recommended', label: 'Recommended' },
    { value: 'updated', label: 'Recently updated' },
    { value: 'name', label: 'Name: A–Z' },
  ]);

  /** Read only supported catalogue filters from a shareable hash route. */
  function read(hash) {
    const query = new URLSearchParams(String(hash || '').split('?').slice(1).join('?'));
    const category = query.get('category');
    const order = query.get('sort');
    return { query: query.get('q') || '', category: C.CATEGORIES.includes(category) ? category : 'all',
      limited: query.get('limited') === '1', order: SORTS.some(item => item.value === order) ? order : 'recommended' };
  }

  /** Encode filters in the hash so static hosting, OAuth returns and browser history preserve them. */
  function url(view, state) {
    const query = new URLSearchParams();
    if (state.query) query.set('q', state.query);
    if (C.CATEGORIES.includes(state.category)) query.set('category', state.category);
    if (state.limited) query.set('limited', '1');
    if (state.order !== 'recommended' && SORTS.some(item => item.value === state.order)) query.set('sort', state.order);
    return '#/' + (view === 'library' ? 'library' : '') + (query.size ? '?' + query : '');
  }

  /** Search and gameplay filters apply before faceting; unavailable files have no known permissions. */
  function candidates(mods, state) {
    return M.filterMods(mods, state.query).filter(mod => !state.limited || (!mod.unavailable &&
      !(mod.capabilities || []).some(name => M.capability(name)?.sensitive)));
  }

  /** Count each category against the same search and gameplay restriction, without the selected category. */
  function counts(mods, state) {
    const result = Object.fromEntries(['all', ...C.CATEGORIES].map(name => [name, 0]));
    for (const mod of candidates(mods, state)) {
      result.all++;
      if (!mod.unavailable) result[C.category(mod)]++;
    }
    return result;
  }

  /** Use the API's published-release date; missing or invalid dates remain undated. */
  function publishedAt(mod) {
    if (mod.updated_at == null) return null;
    const value = typeof mod.updated_at === 'number' ? mod.updated_at : Date.parse(mod.updated_at);
    return Number.isFinite(value) ? value : null;
  }

  /** Keep recommendation order, or sort matching releases by name or their actual publication date. */
  function select(mods, state) {
    const visible = candidates(mods, state).filter(mod => state.category === 'all' ||
      (!mod.unavailable && C.category(mod) === state.category));
    if (state.order === 'recommended') return visible;
    return visible.sort((a, b) => {
      if (state.order === 'updated') {
        const left = publishedAt(a), right = publishedAt(b);
        if (left !== right) return left === null ? 1 : right === null ? -1 : right - left;
      }
      return String(a.name).localeCompare(String(b.name)) || String(a.slug).localeCompare(String(b.slug));
    });
  }

  const api = { SORTS, read, url, counts, select };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CinnabarDiscovery = api;
})(typeof window !== 'undefined' ? window : globalThis);
