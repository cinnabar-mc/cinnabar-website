/* Cinnabar Arcade: turns the shared player chart into a high-score graph.
   history.js still owns the data, the ranges, the keyboard and the readout; this only redraws what it drew,
   snapping each line onto a whole-pixel grid, filling under it with a dither, and showing the inspected sample in a pixel box. */
(() => {
  'use strict';
  const plot = document.getElementById('history-plot');
  if (!plot) return;
  const NS = 'http://www.w3.org/2000/svg';
  const GRID = 4;
  const body = plot.parentElement;
  const detail = document.getElementById('history-detail');
  const tip = body.querySelector('.chart-tip');
  const snap = v => Math.round(v / GRID) * GRID;
  let marker = null, square = null, busy = false;

  /** Creates an SVG node with attributes. */
  function node(name, attributes) {
    const element = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  /** Rebuilds a line as horizontal-then-vertical runs on the grid, so every corner lands on a whole pixel. */
  function stepped(d) {
    const points = d.trim().split(/\s*[ML]\s*/).filter(Boolean).map(pair => pair.split(',').map(Number));
    if (points.length < 2 || points.some(p => p.length !== 2 || p.some(Number.isNaN))) return null;
    let x = snap(points[0][0]), y = snap(points[0][1]);
    const parts = [`M${x},${y}`];
    for (let i = 1; i < points.length; i++) {
      const nx = snap(points[i][0]), ny = snap(points[i][1]);
      if (nx !== x) parts.push(`H${nx}`);
      if (ny !== y) parts.push(`V${ny}`);
      x = nx; y = ny;
    }
    return { line: parts.join(''), first: snap(points[0][0]), last: x };
  }

  /** Restyles a fresh drawing from history.js: stepped lines, dithered fills and a square cursor. */
  function enhance() {
    if (busy) return;
    busy = true;
    const baseline = plot.querySelector('.chart-grid');
    const bottom = baseline ? snap(Number(baseline.getAttribute('y1'))) : null;
    if (!plot.querySelector('defs[data-arcade]')) {
      const defs = node('defs', { 'data-arcade': '' });
      const pattern = node('pattern', { id: 'arcade-dither', width: 4, height: 4, patternUnits: 'userSpaceOnUse' });
      pattern.append(node('rect', { x: 0, y: 0, width: 2, height: 2, class: 'dither-dot' }), node('rect', { x: 2, y: 2, width: 2, height: 2, class: 'dither-dot' }));
      defs.append(pattern);
      plot.prepend(defs);
    }
    plot.querySelectorAll('path.chart-line:not([data-stepped])').forEach(path => {
      const result = stepped(path.getAttribute('d') || '');
      if (!result) return;
      path.setAttribute('d', result.line);
      path.setAttribute('data-stepped', '');
      if (bottom !== null) {
        const fill = node('path', { d: `${result.line}V${bottom}H${result.first}Z`, class: 'chart-fill' });
        path.before(fill);
      }
    });
    // history.js appends its cursor circle last; follow it and draw a square marker on the snapped grid.
    const circles = plot.querySelectorAll('circle.chart-point');
    marker = circles.length ? circles[circles.length - 1] : null;
    if (marker && !square?.isConnected) {
      square = node('rect', { width: 8, height: 8, class: 'chart-square', visibility: 'hidden' });
      plot.append(square);
      new MutationObserver(follow).observe(marker, { attributes: true, attributeFilter: ['cx', 'cy', 'visibility'] });
    }
    busy = false;
    follow();
  }

  /** Moves the square marker and the pixel tooltip to the inspected sample. */
  function follow() {
    if (!marker || !square || !tip) return;
    const shown = marker.getAttribute('visibility') === 'visible' && marker.isConnected;
    square.setAttribute('visibility', shown ? 'visible' : 'hidden');
    if (!shown) { tip.hidden = true; return; }
    const x = snap(Number(marker.getAttribute('cx'))), y = snap(Number(marker.getAttribute('cy')));
    square.setAttribute('x', x - 4); square.setAttribute('y', y - 4);
    tip.textContent = detail ? detail.textContent : '';
    tip.hidden = !tip.textContent;
    const width = plot.clientWidth;
    const flip = x > width - 260;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.dataset.side = flip ? 'left' : 'right';
    tip.dataset.below = y < 64 ? 'true' : 'false';
  }

  new MutationObserver(records => { if (records.some(r => r.addedNodes.length)) enhance(); }).observe(plot, { childList: true });
  if (detail) new MutationObserver(follow).observe(detail, { childList: true, characterData: true, subtree: true });
  enhance();
})();
