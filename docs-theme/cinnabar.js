/* Cinnabar book: the phone drawer closes like a drawer, long names in tables can break, and a table that
   scrolls sideways can be reached and scrolled from the keyboard. Chapter text is never changed. */
(() => {
  'use strict';
  const anchor = document.getElementById('mdbook-sidebar-toggle-anchor');
  const wrapper = document.getElementById('mdbook-page-wrapper');
  const drawer = matchMedia('(max-width: 1079px)');

  /** Closes the sidebar through mdBook's own checkbox, so its saved state and ARIA stay in step. */
  function closeDrawer() {
    anchor.checked = false;
    anchor.dispatchEvent(new Event('change'));
  }
  if (anchor && wrapper) {
    // The dim layer over the page is the wrapper's own pseudo-element, so a tap on it targets the wrapper itself.
    wrapper.addEventListener('click', event => {
      if (drawer.matches && anchor.checked && event.target === wrapper) closeDrawer();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !drawer.matches || !anchor.checked) return;
      closeDrawer();
      anchor.focus();
    });
  }

  // Names such as mod_api::ACTION_FILTER_FUEL may break after "::" and "_", so a table need not be wider than a phone.
  document.querySelectorAll('.content td code').forEach(code => {
    if (code.children.length) return;
    const pieces = code.textContent.split(/(::|_)/);
    if (pieces.length < 3) return;
    const nodes = [];
    pieces.forEach((piece, index) => {
      if (!piece) return;
      nodes.push(piece);
      if (index % 2 && index < pieces.length - 1) nodes.push(document.createElement('wbr'));
    });
    code.replaceChildren(...nodes);
  });

  /** Names a table after the heading above it. */
  function tableName(table) {
    for (let node = table.previousElementSibling; node; node = node.previousElementSibling) {
      if (/^H[1-6]$/.test(node.tagName)) return `Table: ${node.textContent.trim()}`;
    }
    return 'Table';
  }
  /** Makes a table focusable only while it scrolls sideways, so it never adds an empty Tab stop. */
  function reach(table) {
    if (table.scrollWidth > table.clientWidth + 1) {
      table.tabIndex = 0;
      table.setAttribute('role', 'region');
      table.setAttribute('aria-label', tableName(table));
    } else {
      table.removeAttribute('tabindex');
      table.removeAttribute('role');
      table.removeAttribute('aria-label');
    }
  }
  const tables = Array.from(document.querySelectorAll('.table-wrapper'));
  tables.forEach(reach);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(entries => entries.forEach(entry => reach(entry.target)));
    tables.forEach(table => observer.observe(table));
  }
})();
