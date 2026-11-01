const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../download-count.js'), 'utf8');

/** Models the DOM and polling clock so failures and visibility changes are deterministic. */
async function page(initial = {downloads: 17753}, hidden = false) {
  const element = tag => ({tag, children: [], textContent: '', attributes: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; }});
  const label = element('p');
  const timers = new Map();
  const requests = [];
  const listeners = {};
  let response = initial;
  let nextId = 0;
  const document = {hidden, getElementById: () => label, createElement: element,
    createElementNS: (_, tag) => element(tag), addEventListener: (key, callback) => { listeners[key] = callback; }};
  const window = {CINNABAR_DOWNLOADS: {download_count_url: 'https://api.invalid/v1/downloads/count',
    release_url: 'https://github.com/fixture/client/releases/latest'},
    setTimeout(callback, delay) { timers.set(++nextId, {callback, delay}); return nextId; },
    clearTimeout(id) { timers.delete(id); }};
  vm.runInNewContext(source, {window, document, AbortSignal,
    async fetch(url, options) {
      requests.push({url, options});
      const current = typeof response === 'function' ? await response() : response;
      if (current instanceof Error) throw current;
      return {ok: current !== 'http-error', json: async () => current};
    }});
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return {label, timers, requests,
    async refresh(next) { response = next; const callbacks = [...timers.values()]; timers.clear(); await Promise.all(callbacks.map(t => t.callback())); },
    async visible(value) { document.hidden = !value; listeners.visibilitychange(); await settle(); }};
}

test('links formatted zero, singular and plural package totals to the shared release destination', async () => {
  const p = await page();
  for (const count of [17753, 0, 1]) {
    await p.refresh({downloads: count});
    const [icon, link] = p.label.children;
    assert.equal(icon.tag, 'svg');
    assert.equal(icon.attributes['aria-hidden'], 'true');
    assert.equal(link.href, 'https://github.com/fixture/client/releases/latest');
    assert.equal(link.children[0].textContent, count.toLocaleString());
    assert.equal(link.children[1], count === 1 ? ' download on GitHub' : ' downloads on GitHub');
  }
  assert.equal(p.requests[0].url, 'https://api.invalid/v1/downloads/count');
  assert.equal(p.requests[0].options.cache, 'no-store');
  assert.equal(p.requests[0].options.credentials, 'omit');
  assert.equal(p.requests[0].options.referrerPolicy, 'no-referrer');
  assert.ok(p.requests[0].options.signal instanceof AbortSignal);
  assert.equal([...p.timers.values()][0].delay, 300000);
});

test('clears unavailable or malformed totals and recovers without showing a fabricated zero', async () => {
  const p = await page();
  for (const invalid of [new Error('offline'), new DOMException('timeout', 'TimeoutError'), 'http-error',
    null, {}, {downloads: -1}, {downloads: 1.2}, {downloads: '3'}, {downloads: '<script>'},
    {downloads: Number.MAX_SAFE_INTEGER + 1}]) {
    await p.refresh(invalid);
    assert.equal(p.label.children.length, 0);
    await p.refresh({downloads: 42});
    assert.equal(p.label.children[1].children[0].textContent, '42');
  }
});

test('pauses in background tabs and does not paint requests completed while hidden', async () => {
  const p = await page({downloads: 2}, true);
  assert.equal(p.requests.length, 0);
  assert.equal(p.timers.size, 0);
  await p.visible(true);
  assert.equal(p.requests.length, 1);
  let finish;
  const refreshing = p.refresh(() => new Promise(resolve => { finish = resolve; }));
  await p.visible(false);
  assert.equal(p.label.children.length, 0);
  finish({downloads: 3});
  await refreshing;
  assert.equal(p.label.children.length, 0);
  assert.equal(p.timers.size, 0);
  await p.visible(true);
  finish({downloads: 4});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.label.children[1].children[0].textContent, '4');
});
