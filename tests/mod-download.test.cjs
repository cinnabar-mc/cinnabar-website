const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {parseHTML} = require('linkedom');

const root = path.resolve(__dirname, '..');
const output = process.env.CINNABAR_SITE_OUTPUT || path.join(root, 'dist');
const html = fs.readFileSync(path.join(output, 'mod/index.html'), 'utf8');
const source = fs.readFileSync(path.join(output, 'app.js'), 'utf8');

/** Run the shared download controller against the rendered mod page, without client config. */
function page() {
  const {window, document} = parseHTML(html);
  // LinkeDOM omits navigation and focus; supply just those browser primitives.
  Object.defineProperty(document, 'activeElement', {value: document.body, writable: true});
  window.HTMLElement.prototype.focus = function () { document.activeElement = this; };
  const location = {assign(url) { this.destination = url; }};
  vm.runInNewContext(source, {document, window: {location}});
  const element = id => document.getElementById(id);
  const click = id => element(id).dispatchEvent(new window.Event('click', {bubbles: true}));
  /** Dispatch a bubbling keyboard event as a focused menu control would. */
  function key(id, name) {
    const event = new window.Event('keydown', {bubbles: true, cancelable: true});
    event.key = name;
    element(id).dispatchEvent(event);
    return event;
  }
  return {document, element, click, key, location};
}

test('mod download is a plain Beta link before JavaScript and stays Beta on initialization', () => {
  const {document} = parseHTML(html);
  const fallback = document.getElementById('download');
  const endpoint = fallback.dataset.modDownload;
  assert.equal(new URL(endpoint).pathname, '/v1/mod/download');
  assert.equal(fallback.href, `${endpoint}?channel=beta`);
  assert.equal(fallback.textContent, 'Download Cinnabar Mod');
  const p = page();
  assert.equal(p.element('download').href, fallback.href);
  assert.equal(p.element('channel-beta').getAttribute('aria-checked'), 'true');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.location.destination, undefined);
});

test('mod channels use the home page wording and menu semantics', () => {
  const home = parseHTML(fs.readFileSync(path.join(output, 'index.html'), 'utf8')).document;
  const p = page();
  for (const id of ['channel-toggle', 'channel-menu', 'channel-beta', 'channel-nightly']) {
    assert.equal(p.element(id).outerHTML.replace(/>\s+</g, '><'),
      home.getElementById(id).outerHTML.replace(/>\s+</g, '><'));
  }
});

test('choosing Nightly re-points the mod link without downloading, and Beta can be selected again', () => {
  const p = page();
  const endpoint = p.element('download').dataset.modDownload;
  const note = p.document.querySelector('[data-channel-note]');
  assert.equal(note.hidden, true);
  for (const channel of ['nightly', 'beta']) {
    p.click('channel-toggle');
    p.click(`channel-${channel}`);
    assert.equal(p.element('download').href, `${endpoint}?channel=${channel}`);
    assert.equal(p.location.destination, undefined);
    assert.equal(p.element(`channel-${channel}`).getAttribute('aria-checked'), 'true');
    assert.equal(p.element(`channel-${channel === 'beta' ? 'nightly' : 'beta'}`).getAttribute('aria-checked'), 'false');
    assert.equal(p.element('channel-menu').hidden, true);
    assert.equal(p.element('channel-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(p.document.activeElement.id, 'channel-toggle');
    assert.equal(note.hidden, channel !== 'nightly');
  }
});

test('mod menu arrows wrap focus, Escape returns focus, and Enter/Space select channels', () => {
  const p = page();
  const endpoint = p.element('download').dataset.modDownload;
  assert.equal(p.key('channel-toggle', 'ArrowDown').defaultPrevented, true);
  assert.equal(p.document.activeElement.id, 'channel-beta');
  assert.equal(p.element('channel-toggle').getAttribute('aria-expanded'), 'true');
  p.key('channel-beta', 'ArrowUp');
  assert.equal(p.document.activeElement.id, 'channel-nightly');
  p.key('channel-nightly', 'ArrowDown');
  assert.equal(p.document.activeElement.id, 'channel-beta');
  p.key('channel-beta', 'Escape');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.document.activeElement.id, 'channel-toggle');
  assert.equal(p.location.destination, undefined);
  p.key('channel-toggle', 'ArrowUp');
  assert.equal(p.document.activeElement.id, 'channel-nightly');
  assert.equal(p.key('channel-nightly', 'Enter').defaultPrevented, true);
  assert.equal(p.element('download').href, `${endpoint}?channel=nightly`);
  assert.equal(p.document.activeElement.id, 'channel-toggle');
  p.click('channel-toggle');
  assert.equal(p.document.activeElement.id, 'channel-nightly');
  p.key('channel-nightly', 'ArrowUp');
  assert.equal(p.key('channel-beta', ' ').defaultPrevented, true);
  assert.equal(p.element('download').href, `${endpoint}?channel=beta`);
  assert.equal(p.location.destination, undefined);
});

test('the mod page states the server risk in the home page\'s words and names its captures', () => {
  const home = parseHTML(fs.readFileSync(path.join(output, 'index.html'), 'utf8')).document;
  const p = page();
  const warning = p.document.querySelector('.hero .warning .disclaimer');
  assert.ok(warning.textContent.includes('some servers may ban you'));
  assert.equal(warning.textContent, home.querySelector('.warning .disclaimer').textContent);
  for (const shot of p.document.querySelectorAll('a.shot')) {
    assert.equal(shot.hasAttribute('aria-label'), false);
    assert.ok(shot.querySelector('img').alt.length > 40);
    assert.equal(shot.querySelector('.visually-hidden').textContent.trim(), 'Open the full-size screenshot.');
  }
});

test('outside clicks close the mod menu without changing the selected channel', () => {
  const p = page();
  p.click('channel-toggle');
  p.click('download');
  assert.equal(p.element('channel-menu').hidden, false);
  p.click('install-title');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.element('channel-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(p.element('channel-beta').getAttribute('aria-checked'), 'true');
});
