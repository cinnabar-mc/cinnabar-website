/* Cinnabar Arcade: the effects switch, the score line and the mode-select label.
   The score line only mirrors what the shared scripts already wrote into the page; it never asks the API itself. */
(() => {
  'use strict';
  const root = document.documentElement;
  const KEY = 'cinnabar-arcade-fx';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Effects: scanlines, phosphor bloom and the moving scene ---------- */

  const toggles = Array.from(document.querySelectorAll('[data-fx-toggle]'));
  /** Applies the effects state everywhere and tells the scene. */
  function setEffects(on, remember) {
    root.dataset.fx = on ? 'on' : 'off';
    toggles.forEach(button => {
      button.setAttribute('aria-pressed', String(on));
      const state = button.querySelector('[data-fx-state]');
      if (state) state.textContent = on ? 'On' : 'Off';
    });
    if (remember) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage may be blocked */ } }
    document.dispatchEvent(new CustomEvent('arcade:fx', { detail: on }));
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage may be blocked */ }
  setEffects(saved ? saved === 'on' : !reduce.matches, false);
  toggles.forEach(button => button.addEventListener('click', () => setEffects(root.dataset.fx !== 'on', true)));
  reduce.addEventListener?.('change', () => { if (!saved) setEffects(!reduce.matches, false); });

  /* ---------- Mode select: the toggle key names the chosen channel ---------- */

  const mode = document.getElementById('channel-mode');
  const options = Array.from(document.querySelectorAll('.channel-option[data-channel]'));
  if (mode && options.length) {
    const show = () => {
      const chosen = options.find(option => option.getAttribute('aria-checked') === 'true');
      if (chosen) mode.textContent = chosen.dataset.channel === 'nightly' ? 'Nightly' : 'Beta';
    };
    options.forEach(option => new MutationObserver(show).observe(option, { attributes: true, attributeFilter: ['aria-checked'] }));
    show();
  }

  /* ---------- Score line: mirrors the live counts, the 24h peak and average, and shows the trend ---------- */

  const line = document.querySelector('[data-scoreline]');
  if (!line) return;
  const cell = name => line.querySelector(`[data-score="${name}"]`);
  const trend = line.querySelector('[data-trend]');
  const trendText = line.querySelector('[data-trend-text]');
  const firstToken = text => (text.trim().match(/^[\d.,  \s]*\d/) || [''])[0].trim();
  const decimal = (new Intl.NumberFormat().formatToParts(1.5).find(part => part.type === 'decimal') || { value: '.' }).value;
  /** Reads a number formatted for this locale, so trend comparisons survive grouping and decimal marks. */
  const toNumber = text => Number(text.replace(new RegExp(`[^\\d${decimal === '.' ? '\\.' : decimal}]`, 'g'), '').replace(decimal, '.'));
  const state = { online: '', average: '' };

  /** Writes one score, or two dashes when the source has nothing, so missing data looks missing. */
  function score(name, value) {
    const target = cell(name);
    if (!target) return;
    target.textContent = value || '--';
    target.toggleAttribute('data-missing', !value);
    if (name === 'online' || name === 'average') { state[name] = value; showTrend(); }
  }
  /** Marks whether people online now sit above or below the 24-hour average. */
  function showTrend() {
    if (!trend) return;
    const now = state.online ? toNumber(state.online) : NaN, mean = state.average ? toNumber(state.average) : NaN;
    if (!Number.isFinite(now) || !Number.isFinite(mean) || now === mean) { trend.hidden = true; return; }
    trend.hidden = false;
    trend.dataset.trend = now > mean ? 'up' : 'down';
    trendText.textContent = now > mean ? 'above the 24-hour average' : 'below the 24-hour average';
  }
  /** Follows a source element and re-reads it whenever the shared scripts rewrite it. */
  function follow(id, read) {
    const source = document.getElementById(id);
    if (!source) return;
    const run = () => read(source);
    new MutationObserver(run).observe(source, { childList: true, characterData: true, subtree: true });
    run();
  }
  follow('online-count', node => score('online', firstToken(node.textContent)));
  follow('unique-count', node => score('unique', firstToken(node.textContent)));
  follow('download-count', node => { const strong = node.querySelector('strong'); score('downloads', strong ? strong.textContent.trim() : ''); });
  // The summary follows the chart's range; the score line keeps the 24-hour figures only.
  const day = document.querySelector('[data-history-range="24h"]');
  follow('history-summary', node => {
    if (day && day.getAttribute('aria-pressed') !== 'true') return;
    const parts = node.textContent.split('·').map(part => part.replace(/^[^\d]*/, '').trim());
    if (!node.textContent.trim()) return;
    score('peak', parts[0] || '');
    score('average', parts[1] || '');
  });
})();
