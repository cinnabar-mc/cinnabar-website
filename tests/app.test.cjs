const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const output = process.env.CINNABAR_SITE_OUTPUT || path.join(root, 'dist');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(output, 'downloads.js'), 'utf8'), context);
const config = context.window.CINNABAR_DOWNLOADS;
const assets = {...config.assets, ...config.manual_assets};
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('Linux command fetches the installer from the latest GitHub release', () => {
  assert.equal(config.install_command, `curl -fsSL ${config.download_base}${config.install_script} | sh`);
  const release = new URL(config.download_base);
  assert.equal(release.protocol, 'https:');
  assert.equal(release.pathname, `/${config.repository}/releases/latest/download/`);
});

function page(userAgent, platform, touchPoints = 0, clientPlatform) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', hidden: false, listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      showModal() { this.open = true; }, close() { this.open = false; },
      focus() { this.focused = true; }, select() { this.selected = true; },
      setAttribute(name, value) { this.attrs[name] = value; },
      contains(target) { return target === this || (this.children || []).includes(target); },
      attrs: {},
    });
    return elements.get(id);
  }
  const channelIds = {'channel-beta': 'beta', 'channel-nightly': 'nightly'};
  for (const [id, channel] of Object.entries(channelIds)) {
    Object.assign(element(id), {dataset: {channel}, attrs: {}});
  }
  element('channel-menu').hidden = true;
  element('channel-toggle').attrs = {};
  element('download-split').children = [element('channel-toggle'), element('channel-menu'), ...Object.keys(channelIds).map(element)];
  const outside = {};
  const documentListeners = {};
  const links = Object.entries(assets).flatMap(([os, arches]) =>
    Object.keys(arches).map(arch => ({dataset: {releaseAsset: `${os}/${arch}`}})));
  // One line of each kind the page marks up: a Nightly note, a copy key, its status and a downloaded file's name.
  const marked = {'[data-release-asset]': links, '[data-channel-note]': [{hidden: true}],
    '[data-copy]': [element('copy-command'), element('copy-first-open')],
    '[data-copy-status]': [element('copy-status'), element('first-open-status')],
    '[data-download-file]': [{textContent: ''}]};
  const window = {CINNABAR_DOWNLOADS: config, location: {assign(url) { this.destination = url; }}};
  const navigator = {userAgent, platform, maxTouchPoints: touchPoints, userAgentData: clientPlatform ? {platform: clientPlatform} : undefined,
    clipboard: {writeText: async text => { navigator.copied = text; }}};
  vm.runInNewContext(source, {window, navigator, document: {
    getElementById: element, querySelectorAll: selector => marked[selector],
    addEventListener(name, callback) { documentListeners[name] = callback; },
  }});
  const key = (id, name) => {
    const event = {key: name, target: element(id), prevented: false, preventDefault() { this.prevented = true; }};
    element(id.startsWith('channel-t') ? id : 'channel-menu').listeners.keydown(event);
    return event;
  };
  return {element, window, navigator, links, outside, key, note: marked['[data-channel-note]'][0], file: marked['[data-download-file]'][0],
    documentClick: target => documentListeners.click({target}),
    focusLeaves: target => element('download-split').listeners.focusout({relatedTarget: target}),
    click: id => element(id).listeners.click({currentTarget: element(id), preventDefault() {}})};
}

test('Linux shows a copyable installer command without navigating', () => {
  const p = page('X11; Linux x86_64', 'Linux x86_64');
  p.click('download');
  assert.equal(p.element('install-dialog').open, true);
  assert.equal(p.element('linux-install').hidden, false);
  assert.equal(p.element('macos-install').hidden, true);
  assert.equal(p.element('install-command').value, config.install_command);
  assert.equal(p.window.location.destination, undefined);
  p.click('close-dialog');
  assert.equal(p.element('install-dialog').open, false);
});

test('Windows downloads the manifest setup executable and then shows what to do with it', () => {
  const p = page('Windows NT 10.0', 'Win32');
  assert.equal(p.element('download').attrs.role, 'button');
  p.click('download');
  assert.equal(p.window.location.destination, config.download_base + config.assets.windows.x86_64);
  assert.equal(p.element('install-dialog').open, true);
  assert.equal(p.element('install-title').textContent, 'Install on Windows');
  assert.equal(p.element('windows-install').hidden, false);
  for (const id of ['android-install', 'linux-install', 'macos-install', 'desktop-install']) assert.equal(p.element(id).hidden, true);
  assert.equal(p.file.textContent, config.assets.windows.x86_64);
});

test('the download key also answers Space, as a button does', () => {
  const p = page('Windows NT 10.0', 'Win32');
  const other = {key: 'a', preventDefault() { this.prevented = true; }};
  p.element('download').listeners.keydown(other);
  assert.equal(other.prevented, undefined);
  assert.equal(p.window.location.destination, undefined);
  const space = {key: ' ', preventDefault() { this.prevented = true; }};
  p.element('download').listeners.keydown(space);
  assert.equal(space.prevented, true);
  assert.equal(p.window.location.destination, config.download_base + config.assets.windows.x86_64);
});

test('Mac users get separate Apple silicon and Intel disk images', () => {
  const p = page('Macintosh', 'MacIntel');
  p.click('download');
  assert.equal(p.element('macos-install').hidden, false);
  for (const link of p.links) {
    const [os, arch] = link.dataset.releaseAsset.split('/');
    assert.equal(link.href, config.download_base + assets[os][arch]);
  }
});

test('Android downloads the manifest APK instead of the Linux installer', () => {
  for (const [agent, platform, hints] of [['Linux; Android 15; Pixel 9', 'Linux aarch64'],
    ['Linux', 'Linux', 'Android'], ['Android', '', undefined]]) {
    const p = page(agent, platform, 5, hints);
    assert.equal(p.element('download-label').textContent, 'Download for Android');
    p.click('download');
    assert.equal(p.window.location.destination, config.download_base + config.manual_assets.android.arm64);
    assert.equal(p.element('install-dialog').open, true);
    assert.equal(p.element('install-title').textContent, 'Install on Android');
    assert.equal(p.element('android-install').hidden, false);
    assert.equal(p.element('windows-install').hidden, true);
    assert.equal(p.file.textContent, config.manual_assets.android.arm64);
  }
});

test('iOS, iPad desktop agents and ChromeOS offer all platform choices', () => {
  for (const [agent, platform, touch] of [['iPhone', 'iPhone', 5],
    ['Macintosh', 'MacIntel', 5], ['X11; CrOS', 'Linux', 0], ['unknown', '', 0]]) {
    const p = page(agent, platform, touch);
    p.click('download');
    assert.equal(p.element('desktop-install').hidden, false);
    assert.equal(p.element('download-label').textContent, 'Downloads');
    assert.equal(p.element('install-title').textContent, 'Choose your platform');
    assert.equal(p.links.find(link => link.dataset.releaseAsset === 'android/arm64').href,
      config.download_base + config.manual_assets.android.arm64);
    assert.equal(p.window.location.destination, undefined);
    for (const id of ['windows-install', 'android-install', 'linux-install', 'macos-install']) assert.equal(p.element(id).hidden, true);
  }
});

test('only iPhone and iPad are told that Cinnabar is not available for them', () => {
  for (const [agent, platform, touch] of [['iPhone', 'iPhone', 5], ['Macintosh', 'MacIntel', 5]]) {
    assert.match(page(agent, platform, touch).element('options-intro').textContent, /not available for iPhone or iPad/);
  }
  for (const [agent, platform] of [['X11; CrOS', 'Linux'], ['unknown', ''], ['Windows NT 10.0', 'Win32']]) {
    assert.equal(page(agent, platform).element('options-intro').textContent, '');
  }
});

test('the Mac first-open command has its own copy key and manual fallback', async () => {
  const p = page('Macintosh', 'MacIntel');
  p.element('first-open-command').textContent = 'xattr fixture';
  await p.click('copy-first-open');
  assert.equal(p.navigator.copied, 'xattr fixture');
  assert.equal(p.element('copy-first-open').textContent, 'Copied');
  assert.equal(p.element('first-open-status').textContent, 'Command copied.');
  assert.equal(p.element('copy-command').textContent, '');
  p.navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
  await p.click('copy-first-open');
  assert.equal(p.element('first-open-command').selected, true);
  assert.equal(p.element('first-open-status').textContent, 'Select and copy the command above.');
  p.click('download');
  assert.equal(p.element('copy-first-open').textContent, 'Copy');
  assert.equal(p.element('first-open-status').textContent, '');
});

test('copy completes after the browser clears event.currentTarget', async () => {
  const p = page('Linux', 'Linux');
  const event = {currentTarget: p.element('copy-command')};
  const pending = p.element('copy-command').listeners.click(event);
  event.currentTarget = null;
  await pending;
  assert.equal(p.navigator.copied, config.install_command);
  assert.equal(p.element('copy-command').textContent, 'Copied');
});

test('clipboard rejection selects the install command for manual copying', async () => {
  const p = page('Linux', 'Linux');
  p.navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
  await p.click('copy-command');
  assert.equal(p.element('install-command').focused, true);
  assert.equal(p.element('install-command').selected, true);
});

const nightlyAsset = (os, arch) => config.nightly_base + assets[os][arch];

test('choosing a channel on Android only selects it; the download key fetches the matching APK', () => {
  const p = page('Linux; Android 15', 'Linux aarch64', 5);
  p.click('channel-nightly');
  assert.equal(p.window.location.destination, undefined);
  assert.equal(p.element('install-dialog').open, undefined);
  assert.equal(p.element('channel-nightly').attrs['aria-checked'], 'true');
  p.click('download');
  assert.equal(p.window.location.destination, nightlyAsset('android', 'arm64'));
  p.click('channel-beta');
  assert.equal(p.window.location.destination, nightlyAsset('android', 'arm64'));
  p.click('download');
  assert.equal(p.window.location.destination, config.download_base + config.manual_assets.android.arm64);
});

test('nightly URLs derive from the repository and manifest assets', () => {
  const nightly = new URL(config.nightly_base);
  assert.equal(nightly.pathname, `/${config.repository}/releases/download/nightly/`);
  assert.equal(config.nightly_install_command, `${config.install_command} -s -- --channel nightly`);
});

test('Beta stays the default for the main button and dialog links', () => {
  const p = page('Windows NT 10.0', 'Win32');
  p.click('download');
  assert.equal(p.window.location.destination, config.download_base + config.assets.windows.x86_64);
  assert.equal(p.element('channel-beta').attrs['aria-checked'], 'true');
  assert.equal(p.element('channel-menu').hidden, true);
});

test('choosing Nightly on Windows selects it without downloading, names it, and returns focus to the channel key', () => {
  const p = page('Windows NT 10.0', 'Win32');
  assert.equal(p.note.hidden, true);
  p.click('channel-toggle');
  assert.equal(p.element('channel-menu').hidden, false);
  assert.equal(p.element('channel-toggle').attrs['aria-expanded'], 'true');
  p.click('channel-nightly');
  assert.equal(p.window.location.destination, undefined);
  assert.equal(p.element('install-dialog').open, undefined);
  assert.equal(p.element('channel-nightly').attrs['aria-checked'], 'true');
  assert.equal(p.element('channel-beta').attrs['aria-checked'], 'false');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.element('channel-toggle').focused, true);
  assert.equal(p.note.hidden, false);
  p.click('download');
  assert.equal(p.window.location.destination, nightlyAsset('windows', 'x86_64'));
  p.click('channel-beta');
  assert.equal(p.note.hidden, true);
});

test('Nightly on Mac and Linux updates the dialog links and install command', () => {
  const mac = page('Macintosh', 'MacIntel');
  mac.click('channel-nightly');
  assert.equal(mac.element('install-dialog').open, undefined);
  mac.click('download');
  assert.equal(mac.element('macos-install').hidden, false);
  for (const link of mac.links) {
    const [os, arch] = link.dataset.releaseAsset.split('/');
    assert.equal(link.href, nightlyAsset(os, arch));
  }
  const linux = page('X11; Linux x86_64', 'Linux x86_64');
  linux.click('channel-nightly');
  assert.equal(linux.element('install-dialog').open, undefined);
  assert.equal(linux.element('install-command').value, config.nightly_install_command);
  linux.click('download');
  assert.equal(linux.element('linux-install').hidden, false);
  linux.click('channel-beta');
  assert.equal(linux.element('install-command').value, config.install_command);
});

test('copy follows the active channel', async () => {
  const p = page('Linux', 'Linux');
  p.click('channel-nightly');
  await p.click('copy-command');
  assert.equal(p.navigator.copied, config.nightly_install_command);
});

test('menu keyboard: arrows, Home and End move focus, Space selects, Escape returns to the caret', () => {
  const p = page('Windows NT 10.0', 'Win32');
  assert.equal(p.key('channel-toggle', 'ArrowDown').prevented, true);
  assert.equal(p.element('channel-menu').hidden, false);
  assert.equal(p.element('channel-beta').focused, true);
  p.element('channel-beta').focused = false;
  p.key('channel-beta', 'ArrowDown');
  assert.equal(p.element('channel-nightly').focused, true);
  p.element('channel-beta').focused = false;
  p.key('channel-nightly', 'ArrowDown');
  assert.equal(p.element('channel-beta').focused, true);
  p.element('channel-toggle').focused = false;
  p.key('channel-beta', 'Escape');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.element('channel-toggle').attrs['aria-expanded'], 'false');
  assert.equal(p.element('channel-toggle').focused, true);
  p.key('channel-toggle', 'ArrowUp');
  assert.equal(p.element('channel-nightly').focused, true);
  p.element('channel-beta').focused = false;
  assert.equal(p.key('channel-nightly', 'Home').prevented, true);
  assert.equal(p.element('channel-beta').focused, true);
  p.element('channel-nightly').focused = false;
  assert.equal(p.key('channel-beta', 'End').prevented, true);
  assert.equal(p.element('channel-nightly').focused, true);
  p.element('channel-toggle').focused = false;
  p.key('channel-nightly', ' ');
  assert.equal(p.window.location.destination, undefined);
  assert.equal(p.element('channel-nightly').attrs['aria-checked'], 'true');
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.element('channel-toggle').focused, true);
});

test('Enter selects the focused channel, and outside clicks or focus leaving the keys close the menu', () => {
  const p = page('Windows NT 10.0', 'Win32');
  p.click('channel-toggle');
  p.documentClick(p.element('channel-nightly'));
  assert.equal(p.element('channel-menu').hidden, false);
  p.documentClick(p.outside);
  assert.equal(p.element('channel-menu').hidden, true);
  p.click('channel-toggle');
  p.focusLeaves(p.element('channel-nightly'));
  p.focusLeaves(null);
  assert.equal(p.element('channel-menu').hidden, false);
  p.focusLeaves(p.outside);
  assert.equal(p.element('channel-menu').hidden, true);
  assert.equal(p.element('channel-toggle').attrs['aria-expanded'], 'false');
  p.click('channel-toggle');
  p.key('channel-nightly', 'Enter');
  assert.equal(p.window.location.destination, undefined);
  assert.equal(p.element('channel-nightly').attrs['aria-checked'], 'true');
  p.click('download');
  assert.equal(p.window.location.destination, nightlyAsset('windows', 'x86_64'));
});
