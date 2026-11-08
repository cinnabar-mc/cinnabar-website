const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const M = require('../marketplace-core.js');
const C = require('../marketplace-content.js');
const Mock = require('../marketplace-mock.js');
const root = path.join(__dirname, '..');

/** Settle the controller's short chain of asynchronous API requests. */
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }

/** Exercise the real controller against a DOM and the actual mock transport. */
async function page(hash = '#/', stored, http, options = {}) {
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'dist/mods/index.html'), 'utf8'));
  const memory = stored || new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const location = { hash, search: options.search || '', pathname: '/mods/' };
  location.href = 'https://site.test/mods/' + location.search + hash;
  // LinkeDOM deliberately omits navigation, layout and focus; model only those browser primitives.
  Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
  window.HTMLElement.prototype.focus = function () { if (this.isConnected) document.activeElement = this; };
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return [...this.querySelectorAll('option')].find(option => option.hasAttribute('selected'))?.value || this.querySelector('option')?.value || ''; },
    set(value) { this.querySelectorAll('option').forEach(option => value === option.value ? option.setAttribute('selected', '') : option.removeAttribute('selected')); },
  });
  window.HTMLElement.prototype.showModal = function () { this.open = true; };
  window.HTMLElement.prototype.close = function () { this.open = false; };
  const listeners = {};
  const timers = new Map(); let timerId = 0; let clock = Date.now();
  class ClockDate extends Date { static now() { return clock; } }
  const copied = [];
  const win = { CinnabarMarket: M, CinnabarContent: C, CinnabarMarketMock: Mock,
    CinnabarMarketHttp: { createHttpApi: () => http },
    CINNABAR_DOWNLOADS: { marketplace: { backend: http ? 'http' : 'mock', api_url: 'https://api.invalid/v1' } }, localStorage: storage,
    CinnabarValidation: { validate: async () => ({ imports: [], exports: [] }) },
    addEventListener: (name, fn) => { listeners[name] = fn; }, scrollTo() {}, fetch() {}, location,
    navigator: { clipboard: { writeText: async code => { copied.push(code); } } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: clock + delay }); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'marketplace.js'), 'utf8'), {
    window: win, document, location, history: { replaceState() {} }, URLSearchParams, URL,
    Date: ClockDate, crypto: webcrypto, AbortController, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer,
  });
  await settle();
  /** Change routes exactly as a browser hashchange would. */
  async function route(hash) { location.hash = hash; listeners.hashchange(); await settle(); }
  /** Activate a connected control and settle its transport effects. */
  async function click(element) { assert.ok(element, 'control exists'); element.focus(); element.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); await settle(); }
  /** Enter a value without rerendering the focused input. */
  async function input(selector, value) { const element = document.querySelector(selector); element.value = value; element.focus(); element.dispatchEvent(new window.Event('input', { bubbles: true })); await settle(); }
  /** Select a fictional persona through the actual sign-in dialogue. */
  async function signIn(name) { await click(document.querySelector('#account [data-focus-key="account"]')); await click([...document.querySelectorAll('#signin-body button')].find(button => button.textContent.includes(name))); }
  async function tick(ms = 10000) {
    clock += ms;
    const queued = [...timers.entries()].filter(([, timer]) => timer.at <= clock);
    for (const [id, timer] of queued) { if (timers.delete(id)) await timer.fn(); }
    await settle();
  }
  return { window, document, memory, win, route, click, input, signIn, tick, timers, copied, text: () => document.getElementById('app').textContent };
}

test('search retains input focus, category state survives a detail round trip, and gallery absence is explicit', async () => {
  const p = await page();
  assert.equal(p.document.querySelectorAll('.mod-card').length, 8);
  await p.input('#mod-search', 'coords');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.equal(p.document.activeElement.id, 'mod-search');
  await p.route('#/mod/coords-hud');
  assert.match(p.text(), /No screenshots uploaded/);
  await p.route('#/');
  assert.equal(p.document.querySelector('#mod-search').value, 'coords');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
});

test('compact project overview keeps declared permissions available for review', async () => {
  const p = await page('#/mod/coords-hud');
  assert.match(p.document.querySelector('summary').textContent, /Permissions \(2\)/);
  assert.equal(p.document.querySelector('details').hasAttribute('open'), false);
  await p.click(p.document.querySelector('[data-focus-key="detail:permissions"]'));
  assert.match(p.text(), /HUD/);
  assert.match(p.text(), /Player status/);
  assert.match(p.text(), /SHA-256/);
  await p.click(p.document.querySelector('[data-focus-key="detail:description"]'));
  assert.match(p.text(), /No screenshots uploaded/);
  assert.ok(p.document.querySelector('[data-focus-key="project:add"]'));
});

test('library selections are isolated by identity and removal keeps a usable focus target', async () => {
  const p = await page();
  await p.signIn('MossyCobble');
  await p.route('#/mod/time-changer');
  await p.click(p.document.querySelector('[data-focus-key="project:add"]'));
  await p.route('#/library');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  await p.click(p.document.querySelector('[data-focus-key="remove:time-changer"]'));
  assert.match(p.text(), /Your library is empty/);
  assert.equal(p.document.activeElement.isConnected, true);
  await p.signIn('BlockSmith42');
  assert.match(p.text(), /Your library is empty/);
});

/** A live library fixture with observable mutations and controllable delayed responses. */
function libraryApi() {
  const selection = { slug: 'saved-mod', version: '1.0.0', sha256: 'a'.repeat(64), sent_at: '2026-01-01T00:00:00.000Z' };
  const api = { backend: 'http', calls: [], account: { id: 'player', display_name: 'Player', email: 'player@example.test', xbox: { xuid: 'xbox-player', gamertag: 'Player' }, role: 'player' },
    library: [selection], mods: [], remove: async () => { api.library = []; return { status: 200, body: { removed: true } }; },
    request: async (method, path, body) => {
      api.calls.push(structuredClone({ method, path, body }));
      if (path === '/me') return { status: 200, body: structuredClone({ account: api.account, library: api.library }) };
      if (path === '/mods') return { status: 200, body: api.mods };
      if (path.endsWith('/remove')) return api.remove(body);
      return { status: 404, body: { error: 'Not found.' } };
    } };
  return api;
}

test('live library removes available and unavailable selections with their exact hash and send timestamp', async () => {
  for (const available of [true, false, 'pulled']) {
    const api = libraryApi();
    if (available) api.mods = [{ slug: 'saved-mod', name: 'Saved mod', summary: 'A saved mod.', creator_name: 'Creator', capabilities: [], category: 'Utilities' }];
    if (available === 'pulled') api.library[0].pulled = true;
    const selected = structuredClone(api.library[0]);
    const p = await page('#/library', undefined, api);
    if (available === 'pulled') assert.match(p.text(), /This release is unavailable/);
    assert.equal(p.document.querySelector('#app [role="status"]').textContent, '1 mod');
    await p.click(p.document.querySelector('[data-focus-key="remove:saved-mod"]'));
    assert.deepEqual(api.calls.find(call => call.method === 'POST'), {
      method: 'POST', path: '/mods/saved-mod/remove', body: { sha256: selected.sha256, sent_at: selected.sent_at },
    });
    assert.match(p.text(), /Your library is empty/);
    assert.match(p.document.getElementById('feedback').textContent, /Removed from your library/);
    assert.match(p.document.getElementById('navigation').textContent, /My library \(0\)/);
    assert.equal(p.document.activeElement.isConnected, true);
  }
});

test('live library keeps failed removals retryable and refreshes a stale selection before another attempt', async () => {
  const api = libraryApi();
  api.remove = async () => { throw new Error('offline'); };
  const p = await page('#/library', undefined, api);
  const control = p.document.querySelector('[data-focus-key="remove:saved-mod"]');
  await p.click(control);
  assert.equal(control.disabled, false);
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.match(p.document.getElementById('feedback').textContent, /Cannot reach/);
  api.remove = async () => {
    api.library[0].sent_at = '2026-01-02T00:00:00.000Z';
    return { status: 409, body: { error: 'Your library changed. Review the current selection and try again.' } };
  };
  await p.click(control);
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.match(p.document.getElementById('feedback').textContent, /library changed/);
  api.remove = async () => ({ status: 403, body: { error: 'Refresh the page and try again.' } });
  await p.click(p.document.querySelector('[data-focus-key="remove:saved-mod"]'));
  assert.equal(api.calls.filter(call => call.method === 'POST').at(-1).body.sent_at, '2026-01-02T00:00:00.000Z');
  assert.match(p.document.getElementById('feedback').textContent, /Refresh the page/);
});

test('pending removal rejects duplicate clicks and cannot replace a later route or account', async () => {
  const api = libraryApi(); let finish;
  api.remove = () => new Promise(resolve => { finish = resolve; });
  const p = await page('#/library', undefined, api);
  const control = p.document.querySelector('[data-focus-key="remove:saved-mod"]');
  await p.click(control); await p.click(control);
  assert.equal(control.disabled, true);
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
  api.account = { id: 'other', display_name: 'Other player', email: 'other@example.test', xbox: null, role: 'player' }; api.library = [];
  await p.route('#/library');
  assert.match(p.document.getElementById('account').textContent, /Other player/);
  await p.route('#/');
  finish({ status: 200, body: { removed: true } }); await settle();
  assert.equal(p.win.location.hash, '#/');
  assert.ok(p.document.querySelector('[aria-label="Mod results"]'));
  assert.doesNotMatch(p.document.getElementById('feedback').textContent, /Removed/);
});

test('library serializes different-card removals and keeps recreated filter controls disabled while pending', async () => {
  const api = libraryApi(); let finish;
  api.library.push({ ...api.library[0], slug: 'other-mod', sha256: 'b'.repeat(64) });
  api.remove = body => new Promise(resolve => { finish = () => {
    api.library = api.library.filter(item => item.sha256 !== body.sha256);
    resolve({ status: 200, body: { removed: true } });
  }; });
  const p = await page('#/library', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="remove:saved-mod"]'));
  await p.click(p.document.querySelector('[data-focus-key="remove:other-mod"]'));
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
  await p.input('#mod-search', '');
  const recreated = p.document.querySelector('[data-focus-key="remove:saved-mod"]');
  assert.equal(recreated.disabled, true);
  await p.click(recreated);
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
  finish(); await settle();
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  await p.click(p.document.querySelector('[data-focus-key="remove:other-mod"]'));
  finish(); await settle();
  assert.match(p.text(), /Your library is empty/);
});

test('draft steps preserve content, preview escapes HTML, and another account cannot read a saved draft', async () => {
  const p = await page('#/submit');
  await p.signIn('BlockSmith42');
  await p.input('#draft-name', 'Creator draft');
  await p.input('#draft-description', '## Heading\n<script>alert(1)</script>');
  await p.click(p.document.querySelector('[data-focus-key="draft:preview"]'));
  assert.equal(p.document.querySelector('#app script'), null);
  assert.equal(p.document.querySelector('.markdown h2').textContent, 'Heading');
  await p.click(p.document.querySelector('[data-focus-key="step:media"]'));
  await p.click(p.document.querySelector('[data-focus-key="step:project"]'));
  assert.equal(p.document.querySelector('#draft-name').value, 'Creator draft');
  await p.click(p.document.querySelector('[data-focus-key="draft:save"]'));
  await p.signIn('MossyCobble');
  assert.equal(p.document.querySelector('#draft-name').value, '');
  await p.signIn('BlockSmith42');
  assert.equal(p.document.querySelector('#draft-name').value, 'Creator draft');
});

test('a stale file check cannot replace a newer selection or authorize submission', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  const checks = [];
  p.win.CinnabarValidation.validate = (bytes, options) => new Promise((resolve, reject) => {
    checks.push({ resolve }); options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
  });
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const fileInput = p.document.querySelector('input[type=file]');
  const buffer = Uint8Array.from([0, 97, 115, 109, 13, 0, 1, 0]).buffer;
  /** Select an immutable component-like file through the real input handler. */
  async function select(name) {
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ name, size: 8, arrayBuffer: async () => buffer.slice(0) }] });
    fileInput.dispatchEvent(new p.window.Event('change'));
    for (let i = 0; i < 20 && checks.length < (name === 'old.wasm' ? 1 : 2); i++) await new Promise(resolve => setTimeout(resolve, 5));
  }
  await select('old.wasm'); await select('new.wasm');
  checks[0].resolve({ imports: [], exports: [] }); await settle();
  assert.doesNotMatch(p.text(), /old.wasm · syntax checked/);
  checks[1].resolve({ imports: [], exports: [] }); await settle();
  assert.match(p.text(), /new.wasm · syntax checked/);
});

test('staff queue shows exact command changes and rejected decisions preserve their note', async () => {
  const memory = new Map();
  const api = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  await api.request('GET', '/me');
  const state = JSON.parse(memory.get(Mock.STORAGE_KEY));
  const old = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'approved');
  const next = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'submitted');
  old.grants = { hud: true, commands: ['say'] }; old.reach = 3;
  next.grants = { hud: true, commands: ['op'] }; next.reach = 3;
  memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
  const p = await page('#/staff/queue/' + next.id, memory);
  await p.signIn('RedstoneRook');
  assert.match(p.text(), /Server scan evidence is not connected/);
  assert.match(p.text(), /Commands added: op/);
  assert.match(p.text(), /Commands removed: say/);
  const request = p.document.querySelector('[data-focus-key="decision:changes"]');
  await p.click(request);
  assert.match(p.text(), /Tell the creator why/);
  assert.equal(p.document.activeElement.id, 'review-note');
});

test('an older HTTP API cannot approve command updates from a name-only diff', async () => {
  const memory = new Map();
  const api = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  await api.request('POST', '/auth/preview', { id: '2535400000000301' });
  const state = JSON.parse(memory.get(Mock.STORAGE_KEY));
  const next = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'submitted');
  next.grants = { hud: true, commands: ['op'] }; next.reach = 3;
  memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
  const server = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  const http = { backend: 'http', request: async (...args) => {
    const result = await server.request(...args);
    if (result.body.previous) { delete result.body.previous.grants; delete result.body.previous.diff.commands; }
    return result;
  } };
  const p = await page('#/staff/queue/' + next.id, memory, http);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  assert.match(p.text(), /does not provide the previous command values/);
  assert.equal(p.document.querySelector('#preview-note').hidden, true);
});

test('preview review queue has no live refresh status and no stray placeholder text', async () => {
  const p = await page('#/staff/queue'); await p.signIn('OreKeeper');
  assert.equal(p.document.querySelector('.refresh-controls'), null);
  assert.doesNotMatch(p.text(), /null/);
});

test('resolved reports do not expose a pull action without an editable reason', async () => {
  const p = await page('#/staff/reports'); await p.signIn('RedstoneRook');
  const pulls = [...p.document.querySelectorAll('#app button')].filter(control => control.textContent === 'Pull release');
  assert.equal(pulls.length, 1);
  assert.ok(pulls[0].closest('article').querySelector('textarea'));
});

/** A normalized live API release; all outcomes below come from response fixtures, never UI simulation. */
function liveRelease(state = 'queued') {
  return { id: '42', slug: 'live-mod', name: 'Live mod', version: '1.0.0', status: 'submitted',
    creator: 'creator', creator_name: 'Creator', approvals: [], grants: { hud: true }, capabilities: ['hud'], reach: 0,
    description: '## HUD\n<script>unsafe()</script>', sha256: 'a'.repeat(64), gallery: [], publication: null,
    scan: { state, review_ready: state === 'complete', completed_at: Date.now(), expires_at: Date.now() + 60000,
      report: state === 'complete' ? { deterministic: 'pass', validator: 'test-validator', policy: 'test-policy',
        findings: [], ai: { verdict: 'clear', model: 'test-model', prompt: 'test-prompt', findings: [] } } : null } };
}

/** HTTP-shaped fixture keeps session, reads and mutation responses observable. */
function liveApi(version, role = 'moderator') {
  const calls = [];
  const api = { backend: 'http', calls, account: { id: role === 'player' ? 'creator' : 'staff', display_name: 'Signed in', email: 'signedin@example.test', xbox: null, role },
    fileUrl: id => 'https://api.invalid/v1/staff/versions/' + id + '/file',
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/me') return { status: 200, body: { account: api.account, library: [] } };
      if (path === '/mods') return { status: 200, body: [] };
      if (path === '/me/mods') return { status: 200, body: [structuredClone(version)] };
      if (path === '/staff/queue') return { status: 200, body: version.status === 'submitted' ? [structuredClone(version)] : [] };
      if (path === '/staff/versions/42') return { status: 200, body: structuredClone(version) };
      return { status: 403, body: { error: 'A fresh sign-in is required.' } };
    } };
  return api;
}

test('live review requires server readiness and explanatory notes for AI flags, with inert evidence', async () => {
  const version = liveRelease('queued');
  const api = liveApi(version);
  const p = await page('#/staff/queue/42', undefined, api);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  assert.match(p.text(), /Queued for scanning/);
  assert.equal(p.document.querySelector('#app script'), null);
  Object.assign(version, liveRelease('complete'));
  version.scan.report.ai = { verdict: 'flag', findings: ['<img src=x onerror=unsafe()>'], model: 'review-model', prompt: 'v1' };
  await p.tick();
  assert.match(p.text(), /Flagged for staff review/);
  assert.equal(p.document.querySelector('.scan-findings img'), null);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  await p.input('#review-note', 'Inspected the artifact and resolved the flagged string.');
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, false);
  await p.click(p.document.querySelector('[data-focus-key="decision:approve"]'));
  assert.match(p.text(), /A fresh sign-in is required/);
  await p.tick();
  assert.equal(p.document.querySelector('#review-note').value, 'Inspected the artifact and resolved the flagged string.');
  assert.equal(p.document.activeElement.id, 'review-note');
});

test('creator status refreshes through scanning and automatic publication, pausing when hidden or navigating', async () => {
  const version = liveRelease(); const api = liveApi(version, 'player');
  const p = await page('#/mine/42', undefined, api);
  assert.match(p.text(), /Queued for scanning/);
  version.scan.state = 'running'; await p.tick(); assert.match(p.text(), /Scanning/);
  version.status = 'approved'; version.publication = 'automatic'; await p.tick();
  assert.match(p.text(), /Published automatically/);
  Object.defineProperty(p.document, 'hidden', { configurable: true, value: true });
  p.document.dispatchEvent(new p.window.Event('visibilitychange'));
  assert.equal(p.timers.size, 0);
  Object.defineProperty(p.document, 'hidden', { configurable: true, value: false });
  p.document.dispatchEvent(new p.window.Event('visibilitychange'));
  assert.equal(p.timers.size, 1);
  await p.route('#/'); assert.equal(p.timers.size, 0);
});

test('status refresh preserves review notes on network errors and removes staff controls after session expiry', async () => {
  const version = liveRelease('complete'); const api = liveApi(version);
  const p = await page('#/staff/queue/42', undefined, api);
  await p.input('#review-note', 'Unfinished review note');
  const original = api.request;
  api.request = async (method, path, body) => path === '/me' ? { status: 503, body: { error: 'Offline' } } : original(method, path, body);
  await p.tick();
  assert.match(p.text(), /Status could not refresh/);
  assert.equal(p.document.querySelector('#review-note').value, 'Unfinished review note');
  api.request = original; api.account = null; await p.tick();
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]'), null);
  assert.match(p.text(), /Sign in with a moderator/);
});

test('failed real uploads retain local images and description and forward the complete draft', async () => {
  const version = liveRelease(); const api = liveApi(version, 'player');
  const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Upload test', slug: 'upload-test',
    summary: 'A complete live upload fixture.', description: 'Long description retained', version: '1.0.0', category: 'Interface',
    license: 'MIT', notes: 'Initial release', source: '', gallery: [{ url: 'data:image/png;base64,AQID', caption: 'HUD', alt: 'Coordinates' }] })]]);
  let uploaded;
  api.submit = async (fields, file, gallery) => { uploaded = { fields, file, gallery }; return { status: 413, body: { error: 'Upload rejected. Resize and retry.' } }; };
  const p = await page('#/submit', memory, api);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const input = p.document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [{ name: 'test.wasm', size: 8,
    arrayBuffer: async () => Uint8Array.from([0,97,115,109,13,0,1,0]).buffer }] });
  input.dispatchEvent(new p.window.Event('change'));
  for (let i = 0; i < 20 && !p.text().includes('syntax checked'); i++) { await new Promise(resolve => setTimeout(resolve, 5)); await settle(); }
  await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
  p.document.querySelector('#distribution-rights').checked = true;
  p.document.querySelector('form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.match(p.document.querySelector('#feedback').textContent, /Resize and retry/);
  assert.equal(uploaded.fields.license, 'MIT'); assert.equal(uploaded.fields.notes, 'Initial release');
  assert.equal(uploaded.gallery[0].alt, 'Coordinates');
  await p.click(p.document.querySelector('[data-focus-key="step:project"]'));
  assert.equal(p.document.querySelector('#draft-description').value, 'Long description retained');
  await p.click(p.document.querySelector('[data-focus-key="step:media"]'));
  assert.equal(p.document.querySelectorAll('.media-item').length, 1);
});

/** A live account fixture with separate website identity and optional Xbox delivery identity. */
function accountApi(linked = false) {
  const api = libraryApi();
  api.account = { id: 'google-account-1', display_name: 'Google Player', email: 'player@example.test', role: 'admin', suspended: false,
    xbox: linked ? { xuid: 'xbox-1', gamertag: 'Game Player' } : null };
  api.library = [];
  const mod = { ...liveRelease('complete'), status: 'approved', summary: 'A real API response fixture.', history: [] };
  api.mods = [mod];
  api.send = () => ({ status: 200, body: { game_online: true } });
  api.me = () => ({ status: 200, body: structuredClone({ account: api.account, library: api.library, csrf: 'csrf-1', game_online: false }) });
  api.request = async (method, path, body) => {
    api.calls.push({ method, path, body });
    if (path === '/me') return api.me();
    if (path === '/mods') return { status: 200, body: api.mods };
    if (path === '/mods/live-mod') return { status: 200, body: mod };
    if (path === '/me/xbox/link-code') return { status: 200, body: { code: 'ABCD-1234', expires_in: 300 } };
    if (path === '/me/xbox/unlink') { api.account.xbox = null; return { status: 204, body: null }; }
    if (path.endsWith('/send')) return api.send();
    if (path === '/auth/signout') { api.account = null; return { status: 204, body: null }; }
    return { status: 404, body: { error: 'Not found.' } };
  };
  return api;
}

/** Read the linking panel's status independently of the underlying marketplace route. */
function xboxText(p) { return p.document.getElementById('xbox-dialog').textContent; }

/** Change tab visibility through the same event used in browsers. */
function visibility(p, hidden) {
  Object.defineProperty(p.document, 'hidden', { configurable: true, value: hidden });
  p.document.dispatchEvent(new p.window.Event('visibilitychange'));
}

test('live Google account chrome renders display name, quiet email, staff role and separate Xbox status', async () => {
  const api = accountApi();
  const p = await page('#/', undefined, api);
  const account = p.document.getElementById('account');
  assert.match(account.textContent, /Google Player/);
  assert.equal(account.querySelector('.account-email').textContent, 'player@example.test');
  assert.match(account.textContent, /admin/);
  assert.match(account.textContent, /Link Xbox/);
  assert.doesNotMatch(account.textContent, /undefined/);
  await p.click(account.querySelector('[data-focus-key="account"]'));
  assert.equal(p.document.querySelector('#account button').textContent, 'Sign in with Google');
  assert.equal(p.document.querySelector('#preview-note').hidden, true);
});

test('signin_error uses only own messages and never renders injected markup or prototype members', async () => {
  for (const [code, expected] of [['cancelled', 'Sign-in was cancelled.'], ['__proto__', 'Sign-in could not finish. Please retry.'],
    ['constructor', 'Sign-in could not finish. Please retry.'], ['<img src=x onerror=alert(1)>', 'Sign-in could not finish. Please retry.']]) {
    const api = accountApi(); api.account = null;
    const p = await page('#/', undefined, api, { search: '?signin_error=' + encodeURIComponent(code) });
    assert.equal(p.document.getElementById('feedback').textContent, expected);
    assert.equal(p.document.querySelector('#feedback img'), null);
  }
});

test('the unlinked linking panel renders no placeholder text before a code exists', async () => {
  const api = accountApi(); const p = await page('#/', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  assert.doesNotMatch(xboxText(p), /null|undefined/);
});

test('link code shows instructions, copy feedback and a wall-clock countdown with expiry recovery', async () => {
  const api = accountApi(); const p = await page('#/', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  assert.match(xboxText(p), /Mods you add are sent to the game on your linked Xbox account/);
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  assert.deepEqual(api.calls.find(call => call.path === '/me/xbox/link-code'), { method: 'POST', path: '/me/xbox/link-code', body: undefined });
  assert.equal(p.document.getElementById('xbox-code').textContent, 'ABCD-1234');
  assert.match(xboxText(p), /In Cinnabar, open Settings → Account → Link website account and enter this code\./);
  assert.equal(p.document.getElementById('xbox-countdown').textContent, 'Expires in 5:00');
  await p.tick(1000);
  assert.equal(p.document.getElementById('xbox-countdown').textContent, 'Expires in 4:59');
  await p.click(p.document.querySelector('[data-focus-key="xbox:copy"]'));
  assert.deepEqual(p.copied, ['ABCD-1234']);
  assert.match(xboxText(p), /Link code copied/);
  await p.tick(299000);
  assert.match(xboxText(p), /This code expired/);
  assert.equal(p.document.querySelector('[data-focus-key="xbox:copy"]').disabled, true);
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  assert.equal(p.document.getElementById('xbox-countdown').textContent, 'Expires in 5:00');
});

test('the open linking panel follows a link that another session refresh noticed first', async () => {
  const api = accountApi();
  const request = api.request;
  api.request = async (method, path, body) => path === '/me/mods' ? { status: 200, body: [] } : request(method, path, body);
  const p = await page('#/mine', undefined, api);
  await p.tick(9000);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  api.account.xbox = { xuid: 'xbox-2', gamertag: 'Refreshed Gamertag' };
  await p.tick(1000);
  assert.equal(p.document.querySelector('[data-focus-key="account:xbox"]').textContent, 'Xbox linked');
  await p.tick(3000);
  assert.match(xboxText(p), /Refreshed Gamertag/);
  assert.equal(p.document.getElementById('xbox-code'), null);
});

test('link polling detects gamertag, pauses while hidden, resumes with current expiry and stops on close', async () => {
  const api = accountApi(); const p = await page('#/', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  const reads = () => api.calls.filter(call => call.path === '/me').length;
  visibility(p, true);
  assert.equal(p.timers.size, 0);
  const before = reads(); await p.tick(20000); assert.equal(reads(), before);
  visibility(p, false);
  assert.equal(p.document.getElementById('xbox-countdown').textContent, 'Expires in 4:40');
  api.account.xbox = { xuid: 'different-xbox-id', gamertag: 'Linked Gamertag' };
  await p.tick(3000);
  assert.equal(reads(), before + 1);
  assert.match(xboxText(p), /Linked Gamertag/);
  assert.equal(p.document.getElementById('xbox-code'), null);
  assert.equal(p.document.querySelector('[data-focus-key="account:xbox"]').textContent, 'Xbox linked');
  await p.click(p.document.getElementById('xbox-close'));
  assert.equal(p.document.getElementById('xbox-dialog').open, false);
  assert.equal(p.document.activeElement.getAttribute('data-focus-key'), 'account:xbox');
  assert.equal(p.timers.size, 0);
  await p.tick(); assert.equal(reads(), before + 1);
});

test('dismissed and hidden in-flight link polls cannot replace a newer session', async () => {
  for (const dismiss of ['close', 'hide', 'hide-resume']) {
    const api = accountApi(); const p = await page('#/', undefined, api);
    await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
    let finish;
    api.me = () => new Promise(resolve => { finish = resolve; });
    const pending = p.tick(3000); await settle();
    if (dismiss === 'close') await p.click(p.document.getElementById('xbox-close'));
    else { visibility(p, true); if (dismiss === 'hide-resume') visibility(p, false); }
    finish({ status: 200, body: { account: { ...api.account, display_name: 'Stale account', xbox: { xuid: 'x', gamertag: 'Stale link' } }, library: [] } });
    await pending;
    assert.doesNotMatch(p.document.getElementById('account').textContent, /Stale/);
    assert.doesNotMatch(xboxText(p), /Could not refresh/);
    assert.equal(p.timers.size, dismiss === 'hide-resume' ? 1 : 0);
  }
});

test('unlink requires a separate confirmation and preserves the library and account identity', async () => {
  const api = accountApi(true); api.library = [{ slug: 'saved', sha256: 'a'.repeat(64) }];
  const p = await page('#/', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  assert.match(xboxText(p), /Game Player/);
  await p.click(p.document.querySelector('[data-focus-key="xbox:unlink"]'));
  assert.match(xboxText(p), /Unlink Game Player\?/);
  assert.equal(api.calls.some(call => call.path === '/me/xbox/unlink'), false);
  await p.click(p.document.querySelector('[data-focus-key="xbox:cancel"]'));
  assert.equal(api.calls.some(call => call.path === '/me/xbox/unlink'), false);
  await p.click(p.document.querySelector('[data-focus-key="xbox:unlink"]'));
  await p.click(p.document.querySelector('[data-focus-key="xbox:confirm"]'));
  assert.equal(api.calls.filter(call => call.path === '/me/xbox/unlink').length, 1);
  assert.match(xboxText(p), /Get link code/);
  assert.match(p.document.getElementById('account').textContent, /Google Player/);
  assert.match(p.document.getElementById('navigation').textContent, /My library \(1\)/);
});

test('Add to Cinnabar opens linking before sending, including a server 409 after a stale linked session', async () => {
  for (const linked of [false, true]) {
    const api = accountApi(linked);
    api.send = () => { api.account.xbox = null; return { status: 409, body: { error: 'Link your Xbox account in Cinnabar first.' } }; };
    const p = await page('#/mod/live-mod', undefined, api);
    await p.click(p.document.querySelector('[data-focus-key="project:add"]'));
    assert.equal(p.document.getElementById('xbox-dialog').open, true);
    assert.match(xboxText(p), /Get link code/);
    assert.equal(api.calls.filter(call => call.path.endsWith('/send')).length, linked ? 1 : 0);
  }
});

test('drafts use Google account ids without Xbox, survive linking and remain isolated after account switches', async () => {
  const api = accountApi(); const p = await page('#/submit', undefined, api);
  await p.input('#draft-name', 'Google draft');
  await p.click(p.document.querySelector('[data-focus-key="draft:save"]'));
  assert.equal(JSON.parse(p.memory.get('cinnabar.marketplace.draft.google-account-1')).name, 'Google draft');
  assert.equal(p.memory.has('cinnabar.marketplace.draft.undefined'), false);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  api.account.xbox = { xuid: 'not-a-website-id', gamertag: 'Game Player' }; await p.tick(3000);
  await p.click(p.document.getElementById('xbox-close'));
  await p.route('#/submit'); assert.equal(p.document.querySelector('#draft-name').value, 'Google draft');
  const first = api.account;
  api.account = { ...first, id: 'google-account-2' };
  await p.route('#/library'); await p.route('#/submit');
  assert.equal(p.document.querySelector('#draft-name').value, '');
  api.account = first;
  await p.route('#/library'); await p.route('#/submit');
  assert.equal(p.document.querySelector('#draft-name').value, 'Google draft');
});

test('mock preview retains personas and demonstrates code linking and unlinking for an unlinked Google account', async () => {
  const p = await page();
  assert.equal(p.document.querySelectorAll('.mod-card').length, 8);
  assert.equal(p.document.querySelector('#preview-note').hidden, false);
  await p.signIn('GoogleBuilder');
  assert.match(p.document.getElementById('account').textContent, /googlebuilder@example.test/);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  assert.equal(p.document.getElementById('xbox-code').textContent, 'DEMO-1234');
  await p.click(p.document.querySelector('[data-focus-key="xbox:simulate"]'));
  assert.match(xboxText(p), /GoogleBuilder/);
  assert.ok(p.document.querySelector('[data-focus-key="xbox:unlink"]'));
});

test('staff people and role writes use Cinnabar display names instead of Xbox gamertags', async () => {
  const api = accountApi(); const original = api.request;
  api.request = async (method, path, body) => path === '/staff/people'
    ? { status: 200, body: [{ id: 'staff-1', display_name: 'Staff Person', role: 'admin' }] } : original(method, path, body);
  const p = await page('#/staff/people', undefined, api);
  assert.match(p.text(), /Staff Person/);
  assert.match(p.text(), /Display name/);
  await p.input('#staff-name', 'New Moderator');
  await p.input('#staff-reason', 'Helps with reports.');
  p.document.querySelector('form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.deepEqual(structuredClone(api.calls.find(call => call.path === '/staff/people/role').body),
    { display_name: 'New Moderator', role: 'player', reason: 'Helps with reports.' });
});
