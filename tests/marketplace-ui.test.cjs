const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const M = require('../marketplace-core.js');
const C = require('../marketplace-content.js');
const D = require('../marketplace-discovery.js');
const U = require('../marketplace-upload.js');
const Mock = require('../marketplace-mock.js');
const root = path.join(__dirname, '..');

/** Settle the controller's short chain of asynchronous API requests. */
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }

/** Exercise the real controller against a DOM and the actual mock transport. */
async function page(hash = '#/', stored, http, options = {}) {
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'dist/mods/index.html'), 'utf8'));
  const memory = stored || new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const sessionMemory = options.sessionMemory || new Map();
  const sessionStorage = { getItem: key => sessionMemory.get(key) ?? null, setItem: (key, value) => sessionMemory.set(key, value) };
  const location = { hash, search: options.search || '', pathname: '/mods/' };
  location.href = 'https://site.test/mods/' + location.search + hash;
  // LinkeDOM deliberately omits navigation, layout and focus; model only those browser primitives.
  Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
  window.HTMLElement.prototype.focus = function () { if (this.isConnected) document.activeElement = this; };
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolled.push({ id: this.id, options }); };
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
  const win = { CinnabarMarket: M, CinnabarContent: C, CinnabarDiscovery: D, CinnabarMarketMock: Mock,
    CinnabarUpload: { ...U, prepareImage: options.prepareImage || (async file => ({ file, name: file.name,
      sha256: file.sha256 || 'b'.repeat(64), caption: '', alt: '', url: 'data:image/png;base64,AQID' })) },
    CinnabarMarketHttp: { createHttpApi: () => http },
    CINNABAR_DOWNLOADS: { marketplace: { backend: http ? 'http' : 'mock', api_url: 'https://api.invalid/v1' } }, localStorage: storage, sessionStorage,
    CinnabarValidation: { iconUrl: async bytes => bytes ? "data:image/png;base64,AQID" : null, validate: async () => ({ imports: [], exports: [] }) },
    addEventListener: (name, fn) => { listeners[name] = fn; }, scrollTo() {}, fetch() {}, location,
    navigator: { clipboard: { writeText: async code => { copied.push(code); } } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: clock + delay }); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'marketplace.js'), 'utf8'), {
    window: win, document, location, history: { replaceState(_state, _title, value) {
      const updated = new URL(value, location.href);
      Object.assign(location, { href: updated.href, hash: updated.hash, search: updated.search, pathname: updated.pathname });
    } }, URLSearchParams, URL,
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
  return { window, document, memory, sessionMemory, win, route, click, input, signIn, tick, timers, copied, scrolled, text: () => document.getElementById('app').textContent };
}

/** Submit the current editor step with the form's real submit handler. */
async function continueEditor(p) {
  p.document.querySelector('form.editor').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

/** Choose a minimal component through the real asynchronous file checker. */
async function editorFile(p, bytes = Uint8Array.from([0,97,115,109,13,0,1,0])) {
  const input = p.document.querySelector('#draft-file');
  Object.defineProperty(input, 'files', { value: [{ name: 'test.wasm', size: bytes.length,
    arrayBuffer: async () => bytes.buffer }] });
  input.dispatchEvent(new p.window.Event('change'));
  for (let i = 0; i < 30 && input.isConnected; i++) { await new Promise(resolve => setTimeout(resolve, 5)); await settle(); }
  assert.match(p.text(), /syntax checked/);
}

/** Choose screenshot fixtures through the editor's real selection and ordering controls. */
async function editorImages(p, files) {
  const input = p.document.getElementById('draft-images');
  Object.defineProperty(input, 'files', { value: files });
  input.dispatchEvent(new p.window.Event('change')); await settle();
}

/** A complete local draft, ready to select and validate a component. */
function uploadDraft() {
  return new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Upload polish', slug: 'upload-polish',
    summary: 'A complete upload recovery example.', description: 'Example description', version: '1.0.0',
    category: 'Interface', license: 'MIT', source: '', notes: 'Initial release' })]]);
}

/** Reach the upload action while retaining explicit distribution consent. */
async function readyUpload(p) {
  await p.click(p.document.querySelector('[data-focus-key="step:release"]')); await editorFile(p);
  await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
  p.document.getElementById('distribution-rights').checked = true;
}

test('project errors are inline, described, focused and scrolled; continuing validates only the current step', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  await continueEditor(p);
  assert.equal(p.document.querySelectorAll('[aria-invalid="true"]').length, 3);
  assert.equal(p.document.activeElement.id, 'draft-name');
  assert.equal(p.scrolled.at(-1).id, 'draft-name');
  assert.equal(p.document.getElementById('feedback').textContent, 'Fix 3 fields to continue.');
  for (const key of ['name', 'slug', 'summary']) {
    const control = p.document.getElementById('draft-' + key);
    assert.ok(control.getAttribute('aria-describedby').split(' ').includes('error-' + key));
    assert.equal(p.document.getElementById('error-' + key).parentNode, control.parentNode);
    assert.ok([...control.parentNode.children].indexOf(p.document.getElementById('error-' + key)) > [...control.parentNode.children].indexOf(control));
  }
  await p.input('#draft-name', 'Steroids for Cinnabar');
  assert.equal(p.document.getElementById('feedback').textContent, 'Fix 1 field to continue.');
  await p.input('#draft-summary', 'A clear project summary.');
  assert.equal(p.document.querySelectorAll('[aria-invalid="true"]').length, 0);
  assert.match(p.document.getElementById('address-preview').textContent, /\/mods\/#\/mod\/steroids-for-cinnabar$/);
  await p.input('#draft-slug', '!bad'); await continueEditor(p);
  assert.equal(p.document.activeElement.id, 'draft-slug');
  assert.equal(p.document.querySelector('#draft-slug').getAttribute('aria-invalid'), 'true');
  await p.input('#draft-slug', 'None');
  assert.equal(p.document.getElementById('draft-slug').value, 'none');
  assert.equal(p.document.getElementById('draft-slug').hasAttribute('aria-invalid'), false);
  assert.equal(p.document.getElementById('error-slug'), null);
  assert.match(p.document.getElementById('draft-slug').getAttribute('aria-describedby'), /hint-slug.*address-preview/);
  await p.input('#draft-slug', '');
  await continueEditor(p); assert.match(p.text(), /Add a release/);
  await continueEditor(p);
  assert.equal(p.document.activeElement.id, 'draft-file');
  assert.equal(p.document.getElementById('feedback').textContent, 'Fix 2 fields to continue.');
  await p.input('#draft-version', '1.0.0'); await editorFile(p); await continueEditor(p);
  assert.match(p.text(), /Ready to submit/);
  await continueEditor(p);
  assert.equal(p.document.activeElement.id, 'distribution-rights');
  assert.match(p.document.getElementById('error-rights').textContent, /distribution rights/);
  const rights = p.document.getElementById('distribution-rights'); rights.checked = true;
  rights.dispatchEvent(new p.window.Event('change')); await settle();
  assert.equal(p.document.getElementById('error-rights'), null);
});

test('every editor field has a consistent Required or Optional label matching its validation', async () => {
  const api = liveApi(liveRelease(), 'player');
  const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ gallery: [{ url: 'data:image/png;base64,AQID', caption: '', alt: '' }] })]]);
  const p = await page('#/submit', memory, api);
  for (const [step, fields] of Object.entries({ project: { name: 'Required', slug: 'Optional', summary: 'Required', description: 'Optional', category: 'Optional', license: 'Optional', source: 'Optional' },
    release: { file: 'Required', version: 'Required', notes: 'Optional' }, checks: { rights: 'Required' } })) {
    await p.click(p.document.querySelector('[data-focus-key="step:' + step + '"]'));
    for (const [key, expected] of Object.entries(fields)) {
      const control = p.document.getElementById(key === 'rights' ? 'distribution-rights' : 'draft-' + key);
      const label = control.closest('label') || p.document.querySelector('label[for="' + control.id + '"]');
      assert.equal(label.querySelector('.field-requirement').textContent, expected, key);
      assert.equal(control.getAttribute('aria-required'), expected === 'Required' ? 'true' : null, key);
    }
  }
});

test('address normalization preserves the edited control and cursor, including composition', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  const control = p.document.getElementById('draft-slug');
  control.setSelectionRange = (start, end) => { control.selectionStart = start; control.selectionEnd = end; };
  control.value = 'My  Project'; control.setSelectionRange(4, 4);
  control.dispatchEvent(new p.window.Event('input')); await settle();
  assert.equal(control.value, 'my-project'); assert.equal(control.selectionStart, 3);
  assert.equal(p.document.getElementById('draft-slug'), control);
  control.value = 'None'; control.dispatchEvent(new p.window.Event('compositionend')); await settle();
  assert.equal(control.value, 'none');
});

test('422 field errors select their step, use inline aria feedback, and clear on editing', async () => {
  for (const [key, step] of [['slug', 'project'], ['source', 'project'], ['category', 'project'], ['version', 'release'], ['notes', 'release'], ['file', 'release']]) {
    const api = liveApi(liveRelease(), 'player');
    let uploaded;
    api.submit = async fields => { uploaded = fields; return { status: 422, body: { error: 'Invalid fields.', fields: { [key]: 'Server correction for ' + key } } }; };
    const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Steroids for Cinnabar', summary: 'A valid project summary.', version: '1.0.0',
      gallery: [{ url: 'data:image/png;base64,AQID', caption: '', alt: '' }] })]]);
    const p = await page('#/submit', memory, api);
    await p.click(p.document.querySelector('[data-focus-key="step:release"]')); await editorFile(p);
    await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
    p.document.getElementById('distribution-rights').checked = true;
    await continueEditor(p);
    assert.equal(uploaded.slug, 'steroids-for-cinnabar'); assert.equal(uploaded.source, '');
    assert.equal(p.document.querySelector('.steps .active').getAttribute('data-focus-key'), 'step:' + step);
    const control = p.document.getElementById('draft-' + key);
    assert.equal(p.document.activeElement, control);
    assert.equal(control.getAttribute('aria-invalid'), 'true');
    assert.match(control.getAttribute('aria-describedby'), new RegExp('error-' + key));
    assert.equal(p.document.getElementById('error-' + key).textContent, 'Server correction for ' + key);
    assert.equal(p.document.getElementById('feedback').textContent, 'Fix 1 field to continue.');
    if (key === 'file') await editorFile(p);
    else if (key === 'category') { control.value = 'Utilities'; control.dispatchEvent(new p.window.Event('change')); await settle(); }
    else await p.input('#draft-' + key, key === 'slug' ? 'another-address' : key === 'source' ? 'https://github.com/you/mod' : '1.0.1');
    assert.equal(p.document.getElementById('error-' + key), null);
  }
});

test('invalid release files show an inline error and a corrected selection clears it', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const input = p.document.getElementById('draft-file');
  Object.defineProperty(input, 'files', { value: [{ name: 'bad.wasm', size: 3, arrayBuffer: async () => new Uint8Array(3).buffer }] });
  input.dispatchEvent(new p.window.Event('change')); await settle();
  assert.equal(p.document.activeElement.id, 'draft-file');
  assert.match(p.document.getElementById('error-file').textContent, /WebAssembly/);
  assert.equal(p.document.getElementById('feedback').textContent, 'Fix 1 field to continue.');
  await editorFile(p);
  assert.equal(p.document.getElementById('error-file'), null);
});

test('search retains input focus, category state survives a detail round trip, and gallery absence is explicit', async () => {
  const p = await page();
  assert.equal(p.document.querySelectorAll('.mod-card').length, 8);
  await p.input('#mod-search', 'coords');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.equal(p.document.activeElement.id, 'mod-search');
  await p.route('#/mod/coords-hud');
  assert.match(p.text(), /No screenshots uploaded/);
  await p.route(p.document.querySelector('.back').getAttribute('href'));
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
  const api = { backend: 'http', calls: [], account: { id: 'player', username: 'Player', email: 'player@example.test', xbox: { xuid: 'xbox-player', gamertag: 'Player' }, role: 'player' },
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
  api.account = { id: 'other', username: 'Other_player', email: 'other@example.test', xbox: null, role: 'player' }; api.library = [];
  await p.route('#/library');
  assert.match(p.document.getElementById('account').textContent, /Other_player/);
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

test('draft steps preserve inert content and another account cannot read a saved draft', async () => {
  const p = await page('#/submit');
  await p.signIn('BlockSmith42');
  await p.input('#draft-name', 'Creator draft');
  await p.input('#draft-description', '## Heading\n<script>alert(1)</script>');
  assert.equal(p.document.querySelector('[data-focus-key="draft:preview"]'), null);
  assert.equal(p.document.querySelector('#app script'), null);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
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
  const api = { backend: 'http', calls, account: { id: role === 'player' ? 'creator' : 'staff', username: 'Signed in', email: 'signedin@example.test', xbox: null, role },
    fileUrl: id => 'https://api.invalid/v1/staff/versions/' + id + '/file',
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/me') return { status: 200, body: { account: api.account, library: [], upload_limits: Mock.UPLOAD_LIMITS } };
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

test('failed real uploads retain description and component, dropping old gallery drafts', async () => {
  const version = liveRelease(); const api = liveApi(version, 'player');
  const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Upload test', slug: 'upload-test',
    summary: 'A complete live upload fixture.', description: 'Long description retained', version: '1.0.0', category: 'Interface',
    license: 'MIT', notes: 'Initial release', source: '', gallery: [{ url: 'data:image/png;base64,AQID', caption: 'HUD', alt: 'Coordinates' }] })]]);
  let uploaded;
  api.submit = async (fields, file, gallery) => { uploaded = { fields, file, gallery }; return { status: 413, body: { error: 'Upload rejected. Resize and retry.' } }; };
  const p = await page('#/submit', memory, api);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  await editorFile(p);
  await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
  p.document.querySelector('#distribution-rights').checked = true;
  p.document.querySelector('form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.match(p.document.querySelector('#feedback').textContent, /Resize and retry/);
  assert.equal(uploaded.fields.license, 'MIT'); assert.equal(uploaded.fields.notes, 'Initial release');
  assert.equal(uploaded.gallery.images.length, 0); assert.equal(uploaded.fields.gallery, undefined);
  await p.click(p.document.querySelector('[data-focus-key="step:project"]'));
  assert.equal(p.document.querySelector('#draft-description').value, 'Long description retained');
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  assert.equal(p.document.querySelectorAll('.media-item').length, 0);
  assert.match(p.text(), /test.wasm/);
});

/** A live account fixture with separate website identity and optional Xbox delivery identity. */
function accountApi(linked = false) {
  const api = libraryApi();
  api.account = { id: 'google-account-1', username: 'ChosenPlayer', email: 'player@example.test', role: 'admin', suspended: false,
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

test('live Google account chrome renders username, quiet email, staff role and separate Xbox status', async () => {
  const api = accountApi();
  const p = await page('#/', undefined, api);
  const account = p.document.getElementById('account');
  assert.match(account.textContent, /ChosenPlayer/);
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

test('a send conflict for a linked account shows its own error instead of the linking panel', async () => {
  const api = accountApi(true);
  api.send = () => ({ status: 409, body: { error: 'Your library is full. Remove a mod to add another.' } });
  const p = await page('#/mod/live-mod', undefined, api);
  await p.click(p.document.querySelector('[data-focus-key="project:add"]'));
  assert.ok(!p.document.getElementById('xbox-dialog').open);
  assert.equal(p.document.getElementById('feedback').textContent, 'Your library is full. Remove a mod to add another.');
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
    finish({ status: 200, body: { account: { ...api.account, username: 'Stale account', xbox: { xuid: 'x', gamertag: 'Stale link' } }, library: [] } });
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
  assert.match(p.document.getElementById('account').textContent, /ChosenPlayer/);
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
  await p.signIn('New player');
  assert.match(p.document.getElementById('account').textContent, /googlebuilder@example.test/);
  await p.click(p.document.querySelector('[data-focus-key="account:xbox"]'));
  await p.click(p.document.querySelector('[data-focus-key="xbox:code"]'));
  assert.equal(p.document.getElementById('xbox-code').textContent, 'DEMO-1234');
  await p.click(p.document.querySelector('[data-focus-key="xbox:simulate"]'));
  assert.match(xboxText(p), /GoogleBuilder/);
  assert.ok(p.document.querySelector('[data-focus-key="xbox:unlink"]'));
});

test('staff people and role writes use Cinnabar usernames instead of Xbox gamertags', async () => {
  const api = accountApi(); const original = api.request;
  api.request = async (method, path, body) => path === '/staff/people'
    ? { status: 200, body: [{ id: 'staff-1', username: 'Staff_Person', role: 'admin' }] } : original(method, path, body);
  const p = await page('#/staff/people', undefined, api);
  assert.match(p.text(), /Staff_Person/);
  assert.match(p.text(), /Username/);
  await p.input('#staff-name', 'New_Moderator');
  await p.input('#staff-reason', 'Helps with reports.');
  p.document.querySelector('form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.deepEqual(structuredClone(api.calls.find(call => call.path === '/staff/people/role').body),
    { username: 'New_Moderator', role: 'player', reason: 'Helps with reports.' });
});

/** Submit the username form through its real controller handler. */
async function submitUsername(p, value) {
  await p.input('#username-input', value);
  p.document.getElementById('username-form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

test('account chrome uses usernames and never renders a legacy Google display name', async () => {
  const api = accountApi();
  api.account.display_name = 'Private Google Name';
  const p = await page('#/submit', undefined, api);
  assert.match(p.document.getElementById('account').textContent, /ChosenPlayer/);
  assert.match(p.text(), /Publishing as ChosenPlayer/);
  assert.doesNotMatch(p.document.body.textContent, /Private Google Name/);
  assert.ok(!p.document.getElementById('username-dialog').open);
});

test('a null username prompts once after sign-in and across reloads, and chrome reopens it with focus', async () => {
  const p = await page();
  assert.ok(!p.document.getElementById('username-dialog').open);
  await p.signIn('New player');
  assert.equal(p.document.getElementById('username-dialog').open, true);
  assert.equal(p.document.activeElement.id, 'username-input');
  assert.match(p.document.getElementById('account').textContent, /Choose a username/);
  assert.match(p.document.getElementById('username-note').textContent, /public.*can’t be changed later/);
  await p.click(p.document.getElementById('username-close'));
  assert.equal(p.document.getElementById('username-dialog').open, false);
  assert.equal(p.document.activeElement.isConnected, true);
  await p.route('#/library'); await p.route('#/');
  assert.equal(p.document.getElementById('username-dialog').open, false);
  const reloaded = await page('#/submit', p.memory, undefined, { sessionMemory: p.sessionMemory });
  assert.ok(!reloaded.document.getElementById('username-dialog').open);
  await reloaded.click(reloaded.document.querySelector('[data-focus-key="account:username"]'));
  assert.equal(reloaded.document.getElementById('username-dialog').open, true);
  reloaded.document.getElementById('username-dialog').dispatchEvent(new reloaded.window.Event('cancel', { cancelable: true }));
  assert.equal(reloaded.document.getElementById('username-dialog').open, false);
  assert.equal(reloaded.document.activeElement.getAttribute('data-focus-key'), 'account:username');
});

test('username validation blocks invalid lengths and characters before posting', async () => {
  const api = accountApi(); api.account.username = null;
  const p = await page('#/', undefined, api);
  for (const [value, message] of [['', /3–16/], ['ab', /3–16/], ['a'.repeat(17), /3–16/], ['has space', /only letters/], ['hÿphen', /only letters/], ['bad-name', /only letters/]]) {
    await submitUsername(p, value);
    assert.match(p.document.getElementById('username-status').textContent, message);
    assert.equal(p.document.getElementById('username-input').getAttribute('aria-invalid'), 'true');
    assert.equal(p.document.activeElement.id, 'username-input');
  }
  assert.equal(api.calls.filter(call => call.path === '/me/username').length, 0);
});

test('username server errors are announced inline and leave the form retryable', async () => {
  for (const [status, error] of [[400, 'That username is reserved.'], [409, 'That username is taken.'], [429, 'Too many attempts. Try again shortly.'], [401, 'Sign in again.'], [403, 'Refresh and try again.']]) {
    const api = accountApi(); api.account.username = null;
    const original = api.request;
    api.request = (method, path, body) => path === '/me/username' ? { status, body: { error } } : original(method, path, body);
    const p = await page('#/', undefined, api);
    await submitUsername(p, 'Valid_Name');
    assert.equal(p.document.getElementById('username-status').textContent, error);
    assert.equal(p.document.getElementById('username-status').getAttribute('role'), 'alert');
    assert.equal(p.document.getElementById('username-dialog').open, true);
    assert.equal(p.document.getElementById('username-confirm').disabled, false);
    assert.equal(p.document.getElementById('username-input').value, 'Valid_Name');
  }
});

test('username success applies the returned session and updates chrome without a legacy name', async () => {
  const p = await page(); await p.signIn('New player');
  await submitUsername(p, 'My_Username42');
  assert.equal(p.document.getElementById('username-dialog').open, false);
  assert.match(p.document.getElementById('account').textContent, /My_Username42/);
  assert.equal(p.document.querySelector('[data-focus-key="account:username"]'), null);
  assert.match(p.document.getElementById('feedback').textContent, /Username saved/);
  assert.equal(p.document.activeElement.isConnected, true);
  await p.route('#/submit');
  assert.match(p.text(), /Publishing as My_Username42/);
  assert.ok(p.document.getElementById('draft-name'));
});

test('publishing requires a username before creating a project', async () => {
  const p = await page(); await p.signIn('New player');
  await p.click(p.document.getElementById('username-close'));
  await p.route('#/submit');
  assert.match(p.text(), /Choose a username to publish/);
  assert.equal(p.document.querySelector('#draft-name'), null);
  assert.equal(p.document.getElementById('username-dialog').open, true);
  await submitUsername(p, 'New_Creator');
  assert.ok(p.document.querySelector('#draft-name'));
});

test('review decisions open the chooser before posting and retain the note for retry', async () => {
  const memory = new Map();
  const store = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const api = Mock.createMockApi(store); await api.request('GET', '/me');
  const state = JSON.parse(memory.get(Mock.STORAGE_KEY));
  const id = '2535400000000301'; state.accounts[id].username = null; state.session = id;
  memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
  const p = await page('#/staff/queue', memory);
  await p.click(p.document.getElementById('username-close'));
  await p.input('#review-note', 'Please explain the permissions.');
  await p.click(p.document.querySelector('[data-focus-key="decision:changes"]'));
  assert.equal(p.document.getElementById('username-dialog').open, true);
  assert.equal(JSON.parse(memory.get(Mock.STORAGE_KEY)).audit.length, state.audit.length);
  await submitUsername(p, 'Review_Lead');
  assert.equal(p.document.getElementById('review-note').value, 'Please explain the permissions.');
  await p.click(p.document.querySelector('[data-focus-key="decision:changes"]'));
  assert.match(p.document.getElementById('feedback').textContent, /Review decision recorded/);
});

test('a pending username write cannot restore an account after sign-out', async () => {
  const api = accountApi(); api.account.username = null; let finish;
  const original = api.request;
  api.request = (method, path, body) => path === '/me/username' ? new Promise(resolve => { finish = resolve; }) : original(method, path, body);
  const p = await page('#/', undefined, api);
  await submitUsername(p, 'Original_Name');
  const pending = api.me().body; pending.account.username = 'Original_Name';
  await p.click(p.document.querySelector('[data-focus-key="account"]'));
  finish({ status: 200, body: pending }); await settle();
  assert.match(p.document.getElementById('account').textContent, /Sign in with Google/);
  assert.doesNotMatch(p.document.getElementById('account').textContent, /Original_Name/);
});

test('successful username writes update the same account after dismissal or reopening and reject duplicate submits', async () => {
  for (const reopen of [false, true]) {
    const api = accountApi(); api.account.username = null; let finish; let posts = 0;
    const original = api.request;
    api.request = (method, path, body) => path === '/me/username' ? (++posts, new Promise(resolve => { finish = resolve; })) : original(method, path, body);
    const p = await page('#/', undefined, api);
    await submitUsername(p, 'Original_Name'); await submitUsername(p, 'Original_Name');
    assert.equal(posts, 1);
    await p.click(p.document.getElementById('username-close'));
    if (reopen) await p.click(p.document.querySelector('[data-focus-key="account:username"]'));
    api.account.username = 'Original_Name';
    finish(api.me()); await settle();
    assert.equal(p.document.getElementById('username-dialog').open, false);
    assert.match(p.document.getElementById('account').textContent, /Original_Name/);
    assert.equal(p.document.querySelector('[data-focus-key="account:username"]'), null);
  }
});

test('old username errors do not populate a reopened chooser', async () => {
  const api = accountApi(); api.account.username = null; let finish;
  const original = api.request;
  api.request = (method, path, body) => path === '/me/username' ? new Promise(resolve => { finish = resolve; }) : original(method, path, body);
  const p = await page('#/', undefined, api);
  await submitUsername(p, 'Original_Name');
  await p.click(p.document.getElementById('username-close'));
  await p.click(p.document.querySelector('[data-focus-key="account:username"]'));
  finish({ status: 409, body: { error: 'Old taken error.' } }); await settle();
  assert.equal(p.document.getElementById('username-dialog').open, true);
  assert.equal(p.document.getElementById('username-status').textContent, '');
  assert.equal(p.document.getElementById('username-confirm').disabled, false);
});

test('editor has three steps, ignores old gallery drafts and saves only current fields', async () => {
  const api = liveApi(liveRelease(), 'player');
  api.account.username = 'WebsiteName'; api.account.email = 'private@example.test'; api.account.xbox = { gamertag: 'Game Name' };
  const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Old draft', summary: 'An existing draft summary.', gallery: [{ url: 'data:image/png;base64,AQID', caption: 'Old image', alt: 'Old alt' }] })]]);
  const p = await page('#/submit', memory, api);
  assert.deepEqual([...p.document.querySelectorAll('.steps button')].map(button => button.textContent), ['1Project', '2Release', '3Checks & publish']);
  assert.equal(p.document.querySelector('.editor-heading p').textContent, 'Publishing as WebsiteName');
  assert.equal(p.document.querySelector('#draft-name').value, 'Old draft');
  assert.equal(p.document.querySelector('[data-focus-key="draft:preview"]'), null);
  assert.match(p.document.getElementById('hint-description').textContent, /Markdown/);
  for (const step of ['project', 'release', 'checks']) {
    await p.click(p.document.querySelector('[data-focus-key="step:' + step + '"]'));
    assert.equal(Boolean(p.document.querySelector('input[accept*="image"]')), step === 'release');
    assert.equal(p.document.querySelectorAll('.gallery-editor-item').length, 0);
    assert.doesNotMatch(p.text(), /Old image|Old alt|Preview description/);
  }
  await p.click(p.document.querySelector('[data-focus-key="draft:save"]'));
  const saved = JSON.parse(memory.get('cinnabar.marketplace.draft.creator'));
  assert.equal(saved.name, 'Old draft'); assert.equal(saved.gallery, undefined);
});

test('Source None shows an inline error through the form handler with no native constraints', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  await p.input('#draft-name', 'Source test'); await p.input('#draft-summary', 'A valid source test summary.'); await p.input('#draft-source', 'None');
  const source = p.document.getElementById('draft-source');
  assert.equal(source.type, 'text'); assert.equal(source.getAttribute('inputmode'), 'url');
  assert.ok(p.document.querySelector('form.editor').hasAttribute('novalidate'));
  assert.equal(p.document.querySelector('.editor [required], .editor [minlength], .editor [maxlength], .editor [pattern], .editor [type=url]'), null);
  await continueEditor(p);
  assert.equal(p.document.activeElement.id, 'draft-source');
  assert.equal(p.document.getElementById('error-source').textContent, 'Enter a GitHub repository link like https://github.com/you/mod, or leave this empty.');
  assert.match(p.document.getElementById('draft-source').getAttribute('aria-describedby'), /error-source/);
  await p.input('#draft-source', ''); await continueEditor(p);
  assert.match(p.text(), /Add a release/);
});

test('checks use plain language, required rights and a notice only in preview mode', async () => {
  for (const live of [false, true]) {
    const p = await page('#/submit', undefined, live ? liveApi(liveRelease(), 'player') : undefined);
    if (!live) await p.signIn('BlockSmith42');
    await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
    assert.match(p.text(), /Ready to submit/); assert.match(p.text(), /After you upload, we check your mod/);
    assert.match(p.text(), /A reviewer approves it before it goes live/); assert.match(p.text(), /Your projects/);
    assert.match(p.text(), /Your mod fileChoose a file/); assert.match(p.text(), /ReviewAfter upload/);
    assert.doesNotMatch(p.text(), /AI triage|Publication route|Established creators|independently validate|browser check cannot|Server validation|Automatic publication/);
    assert.match(p.text(), /I have permission to share this mod/);
    assert.equal(p.document.getElementById('distribution-rights').getAttribute('aria-required'), 'true');
    assert.equal(p.text().includes('This is a preview.'), !live);
    await p.click(p.document.querySelector('[data-focus-key="step:release"]')); await editorFile(p);
    await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
    assert.match(p.text(), /✓ Looks good/);
  }
});

test('release preview uses the extracted component icon, falls back when absent and links real docs', async () => {
  const { png, component, ICON } = require('./icon-fixtures.cjs');
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  assert.ok(p.document.querySelector('.preview-card .mod-icon svg'));
  await editorFile(p, new Uint8Array(component([[ICON, png()]])));
  assert.equal(p.document.querySelector('.preview-card img').getAttribute('src'), 'data:image/png;base64,AQID');
  assert.match(p.document.getElementById('component-icon-status').textContent, /Icon: from your mod file/);
  const href = p.document.querySelector('#component-icon-status a').getAttribute('href');
  const [file, anchor] = href.split('#');
  assert.match(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), new RegExp('id="' + anchor + '"'));
  await editorFile(p);
  assert.equal(p.document.querySelector('.preview-card img'), null);
  assert.ok(p.document.querySelector('.preview-card .mod-icon svg'));
  assert.match(p.document.getElementById('component-icon-status').textContent, /No icon in your mod file; the category icon is used/);
});

test('listing, detail, library and staff rows use API artwork with safe and failed-load fallbacks', async () => {
  for (const icon of ['https://cdn.test/mod.png', null, 'javascript:alert(1)']) {
    const p = await page(); await p.signIn('MossyCobble');
    const state = JSON.parse(p.memory.get(Mock.STORAGE_KEY));
    for (const listing of Object.values(state.listings)) listing.icon = icon;
    p.memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
    // Recreate the controller to load the modified persisted API fixture.
    const next = await page('#/', p.memory);
    const check = selector => {
      const tile = next.document.querySelector(selector);
      assert.ok(tile, selector);
      assert.equal(Boolean(tile.querySelector('img')), Boolean(icon?.startsWith('https:')), selector);
      assert.equal(Boolean(tile.querySelector('svg')), !icon?.startsWith('https:'), selector);
    };
    check('.mod-card .mod-icon');
    await next.route('#/mod/time-changer'); check('.project-heading .mod-icon');
    await next.click(next.document.querySelector('[data-focus-key="project:add"]'));
    await next.route('#/library'); check('.mod-card .mod-icon');
    await next.signIn('PixelWarden'); await next.route('#/staff/queue'); check('.queue .mod-icon');
    if (icon?.startsWith('https:')) {
      const tile = next.document.querySelector('.queue .mod-icon');
      tile.querySelector('img').dispatchEvent(new next.window.Event('error'));
      assert.ok(tile.querySelector('svg')); assert.equal(tile.querySelector('img'), null);
    }
  }
});

test('catalogue filters are shareable, restore on reload and keep result counts and focus in sync', async () => {
  const p = await page('#/?q=coords&category=Interface&sort=updated');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.match(p.document.querySelector('[data-focus-key="category:Interface"]').getAttribute('aria-label'), /1 mod$/);
  await p.input('#mod-search', 'time');
  assert.match(p.win.location.hash, /q=time/);
  assert.equal(p.document.activeElement.id, 'mod-search');
  const same = await page(p.win.location.hash, p.memory);
  assert.equal(same.document.getElementById('mod-search').value, 'time');
  assert.equal(same.document.querySelectorAll('.mod-card').length, 0);
  await same.click(same.document.querySelector('[data-focus-key="catalog:clear"]'));
  assert.equal(same.win.location.hash, '#/');
  assert.equal(same.document.querySelectorAll('.mod-card').length, 8);
});

test('screenshots reorder accessibly, save descriptors only and reselect into their saved positions', async () => {
  const api = liveApi(liveRelease(), 'player');
  const p = await page('#/submit', uploadDraft(), api);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const files = ['b', 'c'].map((value, index) => ({ name: `Screenshot${index}.png`, size: 4, sha256: value.repeat(64) }));
  await editorImages(p, files);
  assert.equal(p.document.querySelectorAll('.gallery-editor-item').length, 2);
  await p.input('[data-image-caption="' + files[1].sha256 + '"]', 'Second screenshot');
  await p.click(p.document.querySelector('[data-focus-key="image:' + files[1].sha256 + ':earlier"]'));
  assert.equal(p.document.querySelector('[data-image-caption]').getAttribute('data-image-caption'), files[1].sha256);
  assert.equal(p.document.activeElement.getAttribute('data-image-caption'), files[1].sha256);
  await p.click(p.document.querySelector('[data-focus-key="draft:save"]'));
  const saved = JSON.parse(p.memory.get('cinnabar.marketplace.draft.creator'));
  assert.deepEqual(saved.images.map(item => item.sha256), [files[1].sha256, files[0].sha256]);
  assert.equal(saved.images[0].url, undefined); assert.equal(saved.images[0].file, undefined);
  const reloaded = await page('#/submit', p.memory, api);
  await reloaded.click(reloaded.document.querySelector('[data-focus-key="step:release"]'));
  assert.match(reloaded.text(), /Reselect Screenshot/);
  await editorImages(reloaded, [files[1]]);
  assert.equal(reloaded.document.querySelectorAll('.gallery-editor-preview img').length, 0);
  assert.equal(reloaded.document.querySelectorAll('img.gallery-editor-preview').length, 1);
  assert.equal(reloaded.document.querySelector('[data-image-caption]').value, 'Second screenshot');
});

test('caption and image-description edits survive another screenshot preparing', async () => {
  let finish;
  const api = liveApi(liveRelease(), 'player');
  const p = await page('#/submit', uploadDraft(), api, { prepareImage: async file => {
    if (file.name === 'extra.png') await new Promise(resolve => { finish = resolve; });
    return { file, name: file.name, sha256: file.sha256, caption: '', alt: '', url: 'data:image/png;base64,AQID' };
  } });
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const hash = 'b'.repeat(64);
  await editorImages(p, [{ name: 'first.png', size: 4, sha256: hash }]);
  await editorImages(p, [{ name: 'extra.png', size: 4, sha256: 'c'.repeat(64) }]);
  assert.match(p.text(), /Preparing screenshots/);
  await p.input('[data-image-caption="' + hash + '"]', 'Edited during preparation');
  await p.input('[data-focus-key="image:' + hash + ':alt"]', 'An updated image description');
  finish(); await settle();
  assert.equal(p.document.querySelectorAll('.gallery-editor-item').length, 2);
  assert.equal(p.document.querySelector('[data-image-caption="' + hash + '"]').value, 'Edited during preparation');
  assert.equal(p.document.querySelector('[data-focus-key="image:' + hash + ':alt"]').value, 'An updated image description');
});

test('a lost upload response recovers its exact receipt without submitting a duplicate release', async () => {
  const api = liveApi(liveRelease(), 'player');
  const artifactHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', Uint8Array.from([0,97,115,109,13,0,1,0]))).toString('hex');
  let received = []; let posts = 0;
  const request = api.request;
  api.request = async (method, path, body) => path === '/me/mods' ? { status: 200, body: received } : request(method, path, body);
  api.submit = async fields => {
    posts++;
    received = [{ ...liveRelease(), ...fields, id: '55', creator: 'creator', gallery: [],
      sha256: artifactHash }];
    throw new Error('Response lost after commit');
  };
  const p = await page('#/submit', uploadDraft(), api); await readyUpload(p);
  await continueEditor(p);
  assert.match(p.text(), /Connection lost/);
  assert.equal(JSON.parse(p.memory.get('cinnabar.marketplace.draft.creator')).pending_upload, true);
  await continueEditor(p);
  assert.equal(posts, 1);
  assert.equal(p.win.location.hash, '#/mine/55');
  assert.equal(p.memory.has('cinnabar.marketplace.draft.creator'), false);
});

test('upload progress and Stop preserve the selected files for a checked retry', async () => {
  const api = liveApi(liveRelease(), 'player'); let options;
  api.submit = (_fields, _file, upload) => {
    options = upload;
    return new Promise((resolve, reject) => upload.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  };
  const p = await page('#/submit', uploadDraft(), api); await readyUpload(p);
  await continueEditor(p);
  options.onProgress({ loaded: 25, total: 100 });
  assert.match(p.text(), /25% uploaded/);
  options.onProgress({ loaded: 100, total: 100 });
  assert.match(p.text(), /Waiting for server confirmation/);
  await p.click(p.document.querySelector('[data-focus-key="upload:stop"]'));
  assert.equal(options.signal.aborted, true);
  assert.match(p.text(), /Upload stopped/);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  assert.match(p.text(), /test.wasm.*syntax checked/);
});

test('late upload responses and progress cannot replace a newer account or route', async () => {
  const api = liveApi(liveRelease(), 'player'); let finish; let options;
  api.submit = (_fields, _file, upload) => { options = upload; return new Promise(resolve => { finish = resolve; }); };
  const p = await page('#/submit', uploadDraft(), api); await readyUpload(p); await continueEditor(p);
  api.account = { ...api.account, id: 'another-account', username: 'AnotherCreator' };
  await p.route('#/library');
  assert.equal(options.signal.aborted, true);
  options.onProgress({ loaded: 100, total: 100 }); finish({ status: 200, body: { id: '55' } }); await settle();
  assert.equal(p.win.location.hash, '#/library');
  await p.route('#/submit');
  assert.ok(p.document.getElementById('draft-name'), p.text());
  assert.equal(p.document.getElementById('draft-name').value, '');
});

test('creator timeline keeps full scan evidence in an expandable section', async () => {
  const version = liveRelease('running'); const p = await page('#/mine/42', undefined, liveApi(version, 'player'));
  assert.deepEqual([...p.document.querySelectorAll('.release-progress li span:last-child')].map(item => item.textContent), ['Uploaded', 'Scanning', 'Review', 'Published']);
  assert.equal(p.document.querySelector('.release-check-details').hasAttribute('open'), false);
  assert.match(p.document.querySelector('.release-progress .state-current').textContent, /Scanning/);
  const details = p.document.querySelector('.release-check-details');
  details.open = true;
  details.dispatchEvent(new p.window.Event('toggle'));
  version.status = 'approved'; version.publication = 'automatic'; await p.tick();
  assert.equal(p.document.querySelector('.release-check-details').hasAttribute('open'), true);
  assert.equal(p.document.querySelectorAll('.release-progress .state-complete').length, 4);
  assert.match(p.text(), /Published automatically/);
});

test('a normal preview upload keeps ordered screenshot metadata and reaches its own release', async () => {
  const memory = new Map();
  const api = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  const original = api.submit; let submitted;
  api.submit = (...args) => (submitted = original.apply(api, args));
  const p = await page('#/submit', memory, api); await p.signIn('BlockSmith42');
  await p.input('#draft-name', 'Gallery upload'); await p.input('#draft-summary', 'A gallery upload example.');
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  await p.input('#draft-version', '1.0.0'); await editorFile(p);
  await editorImages(p, [{ name: 'screen.png', size: 4, sha256: 'b'.repeat(64) }]);
  await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
  p.document.getElementById('distribution-rights').checked = true;
  await continueEditor(p);
  await submitted; await settle();
  assert.match(p.win.location.hash, /^#\/mine\//, p.text());
  await p.route(p.win.location.hash);
  assert.ok(p.document.querySelector('.gallery-picture'));
  assert.match(p.text(), /Awaiting review/);
});

for (const body of [{}, null]) test('an unconfirmed successful response retains the draft and selected component: ' + JSON.stringify(body), async () => {
  const api = liveApi(liveRelease(), 'player'); api.submit = async () => ({ status: 200, body });
  const p = await page('#/submit', uploadDraft(), api); await readyUpload(p); await continueEditor(p);
  assert.equal(p.win.location.hash, '#/submit'); assert.match(p.text(), /not confirmed/);
  assert.equal(JSON.parse(p.memory.get('cinnabar.marketplace.draft.creator')).pending_upload, true);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  assert.match(p.text(), /test.wasm.*syntax checked/);
});
