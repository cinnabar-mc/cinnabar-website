(function () {
  'use strict';
  const M = window.CinnabarMarket;
  const C = window.CinnabarContent;
  const D = window.CinnabarDiscovery;
  const U = window.CinnabarUpload;
  const config = (window.CINNABAR_DOWNLOADS || {}).marketplace || {};
  const app = document.getElementById('app');
  const feedback = document.getElementById('feedback');
  const storage = safeStorage();
  const backend = config.backend === 'mock' ? window.CinnabarMarketMock.createMockApi(storage)
    : config.backend === 'http' && config.api_url ? window.CinnabarMarketHttp.createHttpApi(config.api_url, window.fetch.bind(window), window.location)
      : { backend: 'unavailable', request: async () => ({ status: 503, body: { error: 'Marketplace configuration could not load. Reload this page to retry.' } }),
        signIn: () => announce('Marketplace configuration could not load. Reload this page before signing in.', true) };
  // A configuration failure is neither the preview nor the live backend.
  const previewMode = backend.backend === 'mock';
  const liveMode = backend.backend === 'http';
  let session = { account: null, library: [] };
  let sessionEpoch = 0;
  let removingLibrary = false;
  let generation = 0;
  let filters = D.read(location.hash);
  let draft = null;
  let draftOwner = null;
  let step = 'project';
  let editorErrors = {};
  let distributionRights = false;
  let fileToken = 0;
  let validationPending = false;
  let validationController = null;
  let submitting = false;
  let uploadGeneration = 0;
  let uploadController = null;
  let uploadStatus = null;
  let imageGeneration = 0;
  let imagesPending = false;
  const expandedChecks = new Set();
  let refreshTimer = null;
  let refreshing = false;
  let writes = 0;
  const usernameDialog = document.getElementById('username-dialog');
  const usernameInput = document.getElementById('username-input');
  const usernameStatus = document.getElementById('username-status');
  const usernameConfirm = document.getElementById('username-confirm');
  const usernamePrompted = new Set();
  let usernameReturnFocus = null;
  let usernameEpoch = 0;
  let usernameBusy = false;
  const xboxDialog = document.getElementById('xbox-dialog');
  let xboxPollTimer = null;
  let xboxClockTimer = null;
  let xboxEpoch = 0;
  let xboxOwner = null;
  let xboxCode = null;
  let xboxExpiresAt = 0;
  let xboxBusy = false;
  let xboxConfirm = false;
  let xboxPolling = false;
  let xboxPollGeneration = 0;
  let xboxReturnFocus = null;
  // The Xbox link state the dialog last drew; other session refreshes may change it before a poll does.
  let xboxRendered = null;
  const reviewNotes = new Map();
  const steps = ['project', 'release', 'checks'];
  const paths = {
    hud: '<rect x="4" y="5" width="24" height="22"/><path d="M4 12h24M10 12v15m5-10h8m-8 5h5"/>',
    sun: '<path d="M3 23h26M8 23a8 8 0 0 1 16 0M16 3v5M4 10l4 4m20-4-4 4M2 18h5m18 0h5M11 28h10"/>',
    zoom: '<path d="M10 4H4v6m18-6h6v6M4 22v6h6m18-6v6h-6"/><circle cx="15" cy="15" r="6"/><path d="m19 19 5 5"/>',
    grid: '<rect x="4" y="4" width="24" height="24"/><path d="M12 4v24m8-24v24M4 12h24M4 20h24"/>',
    shield: '<path d="m16 3 10 4v8c0 7-10 13-10 13S6 22 6 15V7zM11 15l4 4 7-8"/>',
    search: '<circle cx="14" cy="14" r="8"/><path d="m20 20 8 8"/>',
    upload: '<path d="M16 23V4m-7 7 7-7 7 7M5 23v6h22v-6"/>',
  };

  /** Degrade to session-only storage when browser storage is disabled. */
  function safeStorage() {
    try { const storage = window.localStorage; storage.getItem('cinnabar'); return storage; }
    catch (_) { return { getItem: () => null, setItem: () => { throw new Error('Storage unavailable.'); }, removeItem: () => {} }; }
  }

  /** Build DOM with text nodes; only the fixed icon vocabulary below uses markup. */
  function h(tag, attrs, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else if (['value', 'checked', 'disabled', 'hidden'].includes(key)) element[key] = value;
      else element.setAttribute(key, value === true ? '' : String(value));
    }
    children.flat(Infinity).forEach(child => {
      if (child !== null && child !== undefined && child !== false) element.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  /** Draw authored geometry, never creator-supplied SVG. */
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths[name];
    return svg;
  }

  /** Use safe API or component artwork, retaining the category fallback if loading fails. */
  function modIcon(mod) {
    const category = C.category(mod);
    const fallback = icon(category === 'Visuals' ? 'sun' : category === 'Camera' ? 'zoom' : category === 'Utilities' ? 'grid' : 'hud');
    const tile = h('div', { class: category === 'Visuals' ? 'mod-icon warm' : 'mod-icon' }, fallback);
    const url = C.imageUrl(mod.icon);
    if (url) {
      const picture = h('img', { src: url, alt: '', referrerpolicy: 'no-referrer',
        crossorigin: mod.private ? 'use-credentials' : null,
        onerror: () => { tile.classList.remove('has-artwork'); tile.replaceChildren(fallback); } });
      tile.classList.add('has-artwork'); tile.replaceChildren(picture);
    }
    return tile;
  }

  /** Create an explicit non-submitting action with a stable focus identity. */
  function button(label, action, className = 'btn quiet', key = '') {
    return h('button', { type: 'button', class: className, 'data-focus-key': key, onclick: action }, label);
  }

  /** Announce action outcomes through one persistent live region. */
  function announce(message, error = false) {
    feedback.textContent = message; feedback.classList.toggle('error', error);
  }

  /** Keep transport failures distinct from empty successful responses. */
  async function call(method, path, body, options) {
    if (method !== 'GET') writes++;
    try { return await backend.request(method, path, body, options); }
    catch (_) { return { status: 0, body: { error: 'Cannot reach the marketplace. Check your connection and retry.' } }; }
    finally { if (method !== 'GET') writes--; }
  }

  /** Recover focus when a mutation replaces the currently focused subtree. */
  function mount(token, node, focusKey) {
    if (token !== generation) return;
    const previous = document.activeElement;
    const key = focusKey || previous?.getAttribute('data-focus-key');
    const hadFocus = app.contains(previous);
    const selection = typeof previous?.selectionStart === 'number' ? [previous.selectionStart, previous.selectionEnd] : null;
    app.replaceChildren(node);
    const target = key && [...app.querySelectorAll('[data-focus-key]')].find(el => el.getAttribute('data-focus-key') === key && !el.disabled);
    if (target) { target.focus(); if (selection && target.setSelectionRange) target.setSelectionRange(...selection); }
    else if (hadFocus) app.focus();
  }

  /** Build a recoverable failure without treating the last cached catalogue as live. */
  function failure(message) {
    return h('section', { class: 'empty', role: 'alert' }, h('h2', {}, 'The marketplace could not load.'),
      h('p', {}, message || 'Please retry.'), button('Try again', render, 'btn primary', 'retry'));
  }

  /** Cancel file work and forget the in-memory draft. */
  function discardDraft() {
    validationController?.abort(); validationPending = false;
    uploadController?.abort(); uploadStatus = null;
    imageGeneration++; imagesPending = false; expandedChecks.clear();
    fileToken++; draft = null; draftOwner = null;
    editorErrors = {}; distributionRights = false; step = 'project';
  }

  /** Reflect server identity; preview account choices never appear in HTTP mode. */
  async function loadSession(expectedGeneration, current = () => true) {
    const response = await call('GET', '/me');
    if (!current() || (expectedGeneration !== undefined && expectedGeneration !== generation)) return { status: 0, stale: true, body: {} };
    if (response.status !== 200) return response;
    if (session.account?.id !== response.body.account?.id) {
      sessionEpoch++;
      closeUsername(); closeXbox(); discardDraft(); reviewNotes.clear();
      submitting = false; uploadGeneration++;
    }
    session = response.body;
    session.library = Array.isArray(session.library) ? session.library : [];
    if (session.account?.username) closeUsername();
    return response;
  }

  /** Remember automatic prompts for this account for the lifetime of this browser session. */
  function promptUsername() {
    const id = session.account?.id;
    if (!id || session.account.username || usernamePrompted.has(id)) return;
    try { if (window.sessionStorage.getItem('cinnabar.username.prompted.' + id)) return; } catch (_) { /* memory fallback */ }
    openUsername();
  }

  /** Open the public-name chooser without losing the current route or draft. */
  function openUsername() {
    if (!session.account) return signIn();
    if (session.account.username || usernameDialog.open) return;
    closeXbox();
    usernamePrompted.add(session.account.id);
    try { window.sessionStorage.setItem('cinnabar.username.prompted.' + session.account.id, '1'); } catch (_) { /* memory fallback */ }
    usernameReturnFocus = document.activeElement;
    usernameInput.value = ''; usernameInput.disabled = false;
    usernameInput.removeAttribute('aria-invalid'); usernameStatus.textContent = '';
    usernameBusy = false; usernameConfirm.disabled = false; usernameConfirm.textContent = 'Confirm username';
    usernameDialog.showModal(); usernameInput.focus();
  }

  /** Dismiss the chooser, invalidate pending work and return focus to a connected control. */
  function closeUsername() {
    if (!usernameDialog.open) return;
    const previous = usernameReturnFocus;
    usernameDialog.close(); usernameEpoch++; usernameBusy = false; usernameReturnFocus = null;
    const key = previous?.getAttribute('data-focus-key');
    const target = previous?.isConnected && previous !== document.body ? previous : [...document.querySelectorAll('[data-focus-key]')]
      .find(control => key && control.getAttribute('data-focus-key') === key);
    (target || document.getElementById('account').querySelector('button'))?.focus();
  }

  /** Only a chosen username may accompany a publishing or review action. */
  function requireUsername() {
    if (session.account?.username) return true;
    openUsername(); return false;
  }

  /** Validate locally, then let the API decide availability and reserved names. */
  async function saveUsername(event) {
    event.preventDefault();
    if (usernameBusy || !usernameDialog.open || !session.account) return;
    const username = usernameInput.value;
    const error = username.length < 3 || username.length > 16 ? 'Use 3–16 characters.'
      : /[^A-Za-z0-9_]/.test(username) ? 'Use only letters, digits or underscores.' : '';
    usernameStatus.textContent = error;
    usernameInput.setAttribute('aria-invalid', error ? 'true' : 'false');
    if (error) { usernameInput.focus(); return; }
    const owner = session.account.id;
    const epoch = usernameEpoch;
    const identity = sessionEpoch;
    usernameBusy = true; usernameInput.disabled = true; usernameConfirm.disabled = true;
    usernameConfirm.textContent = 'Saving…';
    const response = await call('POST', '/me/username', { username });
    if (identity !== sessionEpoch || owner !== session.account?.id) return;
    if (response.status === 200) {
      session = response.body;
      session.library = Array.isArray(session.library) ? session.library : [];
      await render();
      if (identity === sessionEpoch && owner === session.account?.id) { closeUsername(); announce('Username saved.'); }
      return;
    }
    if (!usernameDialog.open || epoch !== usernameEpoch) return;
    usernameBusy = false; usernameInput.disabled = false; usernameConfirm.disabled = false;
    usernameConfirm.textContent = 'Confirm username';
    const fallback = { 400: 'That username is invalid or reserved. Choose another.',
      409: 'That username is taken or already set. Choose another or refresh.',
      429: 'Too many attempts. Try again shortly.', 401: 'Sign in again to choose a username.',
      403: 'Refresh the page and try again.' };
    usernameStatus.textContent = response.body?.error || fallback[response.status] || 'Could not save your username. Try again.';
    usernameInput.setAttribute('aria-invalid', 'true'); usernameInput.focus();
  }

  /** Keep the shared site header and marketplace account/navigation consistent. */
  function chrome(route) {
    document.querySelector('.market-heading').classList.toggle('market-heading-compact', route.view === 'mod');
    const box = document.getElementById('account');
    const account = session.account;
    box.replaceChildren(account ? h('div', { class: 'account-details' },
      h('span', { class: 'who small' }, account.username || button('Choose a username', openUsername, 'btn quiet', 'account:username'),
        h('small', { class: 'account-email' }, account.email),
        previewMode || M.atLeast(account, 'moderator') ? h('small', {}, previewMode ? 'Preview account · ' + account.role : account.role) : null),
      h('div', { class: 'account-actions' },
        button(account.xbox ? 'Xbox linked' : 'Link Xbox', openXbox, 'btn quiet', 'account:xbox'),
        button(previewMode ? 'Switch account' : 'Sign out', previewMode ? signIn : signOut, 'btn quiet', 'account')))
      : button(previewMode ? 'Preview account' : 'Sign in with Google', signIn, 'btn quiet auth-provider', 'account'));
    const links = [['catalogue', D.url('catalogue', filters), 'Explore'], ['library', D.url('library', filters), 'My library (' + session.library.length + ')']];
    if (account) links.push(['mine', '#/mine', 'Your projects']);
    if (M.atLeast(account, 'moderator')) links.push(['staff', '#/staff/queue', 'Review']);
    links.push(['submit', '#/submit', 'Publish a mod']);
    document.getElementById('navigation').replaceChildren(...links.map(([view, href, label]) => h('a', {
      href, 'aria-current': route.view === view ? 'page' : null, class: view === 'submit' ? 'publish-link' : '',
      'data-focus-key': 'nav:' + view, 'data-filter-route': ['catalogue', 'library'].includes(view) ? view : null,
    }, label)));
  }

  /** Use Google's real redirect only through the configured HTTP adapter. */
  async function signIn() {
    if (backend.signIn) { backend.signIn(); return; }
    const response = await call('GET', '/auth/personas');
    if (response.status !== 200) { announce(response.body.error, true); return; }
    const dialog = document.getElementById('signin-dialog');
    document.getElementById('signin-body').replaceChildren(...response.body.map(persona =>
      button(h('span', {}, persona.username || 'New player', h('small', {}, persona.blurb)), async () => {
        const signed = await call('POST', '/auth/preview', { id: persona.id });
        if (signed.status !== 200) { announce(signed.body.error, true); return; }
        discardDraft(); step = 'project';
        dialog.close(); await loadSession(); await render();
        announce('Using the ' + (persona.username || 'new player') + ' preview account.');
      }, 'btn quiet')));
    dialog.showModal();
  }

  /** End the session and discard in-memory artifacts on account changes. */
  async function signOut() {
    generation++; sessionEpoch++; closeUsername(); closeXbox(); window.clearTimeout(refreshTimer);
    const result = await call('POST', '/auth/signout');
    if (result.status !== 200 && result.status !== 204) { await render(); return announce(result.body.error, true); }
    discardDraft(); reviewNotes.clear();
    await loadSession(); location.hash = '#/'; await render(); announce('Signed out.');
  }

  /** Invalidate pending link work and forget codes whenever the dialog is dismissed. */
  function stopXbox() {
    window.clearTimeout(xboxPollTimer); window.clearTimeout(xboxClockTimer);
    xboxEpoch++; xboxOwner = null; xboxCode = null; xboxBusy = false; xboxConfirm = false;
    xboxPollGeneration++; xboxPolling = false;
    xboxReturnFocus = null;
  }

  /** Close linking on sign-out or identity changes as well as the explicit Close action. */
  function closeXbox() {
    const wasOpen = xboxDialog.open;
    const previous = xboxReturnFocus;
    if (wasOpen) xboxDialog.close();
    stopXbox();
    if (wasOpen) {
      const key = previous?.getAttribute('data-focus-key');
      const target = previous?.isConnected ? previous : [...document.querySelectorAll('[data-focus-key]')]
        .find(control => key && control.getAttribute('data-focus-key') === key);
      (target || document.getElementById('account').querySelector('button'))?.focus();
    }
  }

  /** A pending code or poll may only update the account that opened this dialog. */
  function currentXbox(epoch) {
    return xboxDialog.open && xboxEpoch === epoch && xboxOwner === session.account?.id;
  }

  /** Keep a wall-clock expiry visible without replacing the focused dialog controls. */
  function updateXboxClock() {
    window.clearTimeout(xboxClockTimer);
    const countdown = document.getElementById('xbox-countdown');
    if (!xboxDialog.open || !xboxCode || !countdown) return;
    const seconds = Math.max(0, Math.ceil((xboxExpiresAt - Date.now()) / 1000));
    countdown.textContent = seconds ? 'Expires in ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
      : 'This code expired. Get a new link code.';
    const copy = document.querySelector('[data-focus-key="xbox:copy"]');
    if (copy) copy.disabled = !seconds;
    if (seconds && !document.hidden) xboxClockTimer = window.setTimeout(updateXboxClock, 1000);
  }

  /** Request a short-lived code using the authenticated transport and its CSRF token. */
  async function getXboxCode() {
    if (xboxBusy) return;
    const epoch = xboxEpoch;
    xboxBusy = true; renderXbox();
    const result = await call('POST', '/me/xbox/link-code');
    if (!currentXbox(epoch)) return;
    xboxBusy = false;
    if (result.status !== 200 || typeof result.body?.code !== 'string' || !result.body.code
      || !Number.isFinite(result.body.expires_in) || result.body.expires_in <= 0) {
      renderXbox();
      document.getElementById('xbox-status').textContent = result.body?.error || 'Could not get a link code. Please retry.';
      return;
    }
    xboxCode = result.body.code; xboxExpiresAt = Date.now() + result.body.expires_in * 1000;
    renderXbox();
  }

  /** Copy only a current code; clipboard denial leaves the selectable code available. */
  async function copyXboxCode() {
    const epoch = xboxEpoch;
    if (!xboxCode || xboxExpiresAt <= Date.now()) return;
    try {
      await window.navigator.clipboard.writeText(xboxCode);
      if (currentXbox(epoch)) document.getElementById('xbox-status').textContent = 'Link code copied.';
    } catch (_) {
      if (currentXbox(epoch)) document.getElementById('xbox-status').textContent = 'Could not copy. Select the code and copy it manually.';
    }
  }

  /** Require a separate confirmation before disconnecting the game's delivery account. */
  async function unlinkXbox() {
    if (xboxBusy || !xboxConfirm) return;
    const epoch = xboxEpoch;
    xboxBusy = true; renderXbox();
    const result = await call('POST', '/me/xbox/unlink');
    if (!currentXbox(epoch)) return;
    if (result.status !== 204) {
      xboxBusy = false; renderXbox();
      document.getElementById('xbox-status').textContent = result.body?.error || 'Could not unlink Xbox. Please retry.';
      return;
    }
    const refreshed = await loadSession(undefined, () => currentXbox(epoch));
    if (!currentXbox(epoch)) return;
    xboxBusy = false; xboxConfirm = false; renderXbox(); chrome(M.parseRoute(location.hash));
    document.getElementById('xbox-status').textContent = refreshed.status === 200 ? 'Xbox account unlinked.'
      : 'Xbox was unlinked. Close and reopen this panel to refresh your account.';
  }

  /** Render linking, code and linked states using the existing quiet dialog vocabulary. */
  function renderXbox() {
    xboxRendered = JSON.stringify(session.account?.xbox ?? null);
    const focused = document.activeElement;
    const hadFocus = xboxDialog.contains(focused);
    const focusKey = focused?.getAttribute('data-focus-key');
    const linked = session.account?.xbox;
    document.getElementById('xbox-title').textContent = linked ? 'Xbox linked' : 'Link Xbox';
    document.getElementById('xbox-status').textContent = '';
    const body = document.getElementById('xbox-body');
    if (linked) {
      xboxCode = null; window.clearTimeout(xboxClockTimer);
      body.replaceChildren(h('p', {}, 'Mods you add are sent to Cinnabar on ', h('strong', {}, linked.gamertag), '.'),
        xboxConfirm ? h('div', { class: 'gap' }, h('h3', {}, 'Unlink ' + linked.gamertag + '?'),
          h('p', {}, 'You will need to link an Xbox account again before sending more mods to your game.'),
          h('div', { class: 'row xbox-actions gap' }, button('Confirm unlink', unlinkXbox, 'btn quiet', 'xbox:confirm'),
            button('Keep linked', () => { xboxConfirm = false; renderXbox(); }, 'btn quiet', 'xbox:cancel')))
          : button('Unlink', () => { xboxConfirm = true; renderXbox(); }, 'btn quiet gap', 'xbox:unlink'));
    } else {
      // replaceChildren would render a null placeholder as the text "null", so drop absent sections.
      body.replaceChildren(...[h('p', {}, 'Mods you add are sent to the game on your linked Xbox account.'),
        xboxCode ? h('div', { class: 'gap' },
          h('div', { class: 'row xbox-code-row' }, h('code', { id: 'xbox-code', class: 'xbox-code' }, xboxCode),
            button('Copy code', copyXboxCode, 'btn quiet', 'xbox:copy')),
          h('p', { id: 'xbox-countdown', class: 'small muted', role: 'timer', 'aria-live': 'off' }),
          h('p', {}, 'In Cinnabar, open Settings → Account → Link website account and enter this code.')) : null,
        button(xboxBusy ? 'Getting code…' : xboxCode ? 'Get a new link code' : 'Get link code', getXboxCode, 'btn primary gap', 'xbox:code'),
        previewMode && xboxCode ? button('Simulate linking in game', async () => {
          const epoch = xboxEpoch;
          await call('POST', '/auth/preview/xbox-link');
          if (currentXbox(epoch)) await pollXbox();
        }, 'btn quiet gap', 'xbox:simulate') : null].filter(Boolean));
    }
    body.querySelectorAll('button').forEach(control => { control.disabled = xboxBusy; });
    updateXboxClock();
    if (hadFocus && !focused.isConnected) {
      const target = [...body.querySelectorAll('button')].find(control => !control.disabled && control.getAttribute('data-focus-key') === focusKey)
        || body.querySelector('button:not(:disabled)') || document.getElementById('xbox-close');
      target.focus();
    }
  }

  /** Poll only while linking is open and visible, without overlapping a write or another poll. */
  function scheduleXboxPoll() {
    window.clearTimeout(xboxPollTimer);
    if (xboxDialog.open && !document.hidden && xboxOwner === session.account?.id) {
      xboxPollTimer = window.setTimeout(pollXbox, 3000);
    }
  }

  /** Refresh /me to observe the link completed in game; dismissed or hidden polls cannot update UI. */
  async function pollXbox() {
    window.clearTimeout(xboxPollTimer);
    if (!xboxDialog.open || document.hidden) return;
    if (writes || xboxBusy || xboxPolling) { scheduleXboxPoll(); return; }
    const epoch = xboxEpoch;
    const owner = xboxOwner;
    const pollGeneration = xboxPollGeneration;
    xboxPolling = true;
    const result = await loadSession(undefined, () => currentXbox(epoch) && !document.hidden && pollGeneration === xboxPollGeneration);
    if (pollGeneration === xboxPollGeneration) xboxPolling = false;
    if (result.stale) return;
    if (result.status === 200 && owner !== session.account?.id) { await render(); return; }
    if (!currentXbox(epoch) || document.hidden) return;
    if (result.status !== 200) document.getElementById('xbox-status').textContent = 'Could not refresh your Xbox link. Retrying…';
    else {
      chrome(M.parseRoute(location.hash));
      if (xboxRendered !== JSON.stringify(session.account.xbox ?? null)) { xboxConfirm = false; renderXbox(); }
    }
    scheduleXboxPoll();
  }

  /** Let an account link Xbox without losing the current project or automatically sending a mod. */
  async function openXbox() {
    if (!session.account) return signIn();
    if (xboxDialog.open) return;
    stopXbox(); xboxOwner = session.account.id;
    xboxReturnFocus = document.activeElement;
    renderXbox(); xboxDialog.showModal(); scheduleXboxPoll();
  }

  /** Show actual permissions with their client-owned descriptions. */
  function permissions(mod, grants) {
    return h('ul', { class: 'perm-list' }, (mod.capabilities || []).length ? mod.capabilities.map(name => {
      const cap = M.capability(name);
      return h('li', {}, h('span', { class: 'checkline' }, icon('shield'), cap ? cap.label : name),
        cap ? h('span', { class: 'muted' }, cap.description) : null,
        name === 'commands' && grants?.commands ? h('p', { class: 'permission-value' }, grants.commands.join(', ')) : null);
    }) : h('li', { class: 'muted' }, 'No optional permissions declared.'));
  }

  /** Render server-backed scan evidence as inert text, including explicit pending/error states. */
  function scanEvidence(version) {
    if (!version.scan) return h('div', { class: 'notice' }, h('b', {}, previewMode ? 'Server scan evidence is not connected.' : 'Scan evidence is unavailable.'),
      h('p', {}, previewMode ? 'Preview decisions simulate review. They do not certify code safety.' : 'Refresh to retrieve the release status. Missing evidence cannot authorize approval.'));
    const scan = version.scan;
    const report = scan.report;
    const verdict = report?.ai?.verdict;
    const state = C.releaseState(version);
    const status = h('section', { class: 'scan-evidence', 'aria-label': 'Server scan evidence' },
      h('div', { class: 'row between' }, h('h3', {}, 'Release checks'), h('span', { class: 'tag ' + state.tone }, state.label)),
      h('div', { class: 'scan-status' },
        h('div', {}, h('span', {}, 'Scan job'), h('span', {}, scan.state)),
        h('div', {}, h('span', {}, 'Component & media validation'), h('span', {}, report?.deterministic || 'Pending')),
        h('div', {}, h('span', {}, 'AI-assisted review'), h('span', {}, verdict === 'clear' ? 'No concerns flagged' : verdict === 'flag' ? (version.status === 'approved' ? 'Flagged · staff-reviewed' : 'Flagged for staff review') : verdict === 'error' ? 'Failed · publication held' : 'Pending')),
        h('div', {}, h('span', {}, 'Publication'), h('span', {}, version.publication || 'Eligibility evaluated by the API'))),
      h('p', { class: 'small muted' }, 'Static checks and AI triage do not certify safety. Cinnabar asks before enabling permissions.'));
    for (const [name, findings] of [['Validation findings', report?.findings], ['AI findings', report?.ai?.findings]]) {
      if (Array.isArray(findings) && findings.length) status.append(h('h4', { class: 'gap' }, name), h('ul', { class: 'scan-findings' }, findings.slice(0, 32).map(text => h('li', {}, String(text)))));
    }
    if (report) status.append(h('dl', { class: 'facts small' }, h('dt', {}, 'Validator / policy'), h('dd', {}, [report.validator, report.policy].filter(Boolean).join(' · ')),
      h('dt', {}, 'AI model / prompt'), h('dd', {}, [report.ai?.model, report.ai?.prompt].filter(Boolean).join(' · ')),
      h('dt', {}, 'Completed'), h('dd', {}, scan.completed_at ? new Date(scan.completed_at).toLocaleString() : 'Pending')));
    return status;
  }

  /** Display only safe API-derived or locally re-encoded gallery images; private previews include credentials. */
  function galleryView(mod) {
    const gallery = h('div');
    const images = (Array.isArray(mod.gallery) ? mod.gallery : []).filter(item => C.imageUrl(item.url));
    if (!images.length) return h('p', { class: 'gallery-empty small muted' }, 'No screenshots uploaded.');
    const error = h('p', { class: 'notice', hidden: true, role: 'status' }, 'This image is unavailable. Refresh your session or the release status to retry.');
    const picture = h('img', { class: 'gallery-picture', alt: images[0].alt || '', referrerpolicy: 'no-referrer',
      crossorigin: images[0].private ? 'use-credentials' : null,
      onerror: () => { picture.hidden = true; error.hidden = false; } });
    const caption = h('p', { class: 'gallery-caption' });
    const show = image => { picture.hidden = false; error.hidden = true; picture.alt = image.alt || ''; picture.src = C.imageUrl(image.url); caption.textContent = image.caption || ''; };
    show(images[0]);
    gallery.append(picture, error, caption, h('div', { class: 'gallery-thumbs' }, images.map((image, i) => button(image.caption || 'Image ' + (i + 1), () => show(image), 'btn quiet', 'gallery:' + i))));
    return gallery;
  }

  /** Add to the account library without claiming an installation or runtime grant. */
  async function addToLibrary(mod, control) {
    if (!session.account) return signIn();
    if (!session.account.xbox) return openXbox();
    control.disabled = true;
    const owner = session.account.id;
    const result = await call('POST', '/mods/' + encodeURIComponent(mod.slug) + '/send');
    control.disabled = false;
    if (owner !== session.account?.id) return;
    if (result.status === 409) {
      await loadSession();
      if (owner !== session.account?.id) return;
      chrome(M.parseRoute(location.hash));
      // A 409 also reports other conflicts, such as a full library; only a missing link opens linking.
      if (!session.account?.xbox) return openXbox();
      return announce(result.body.error, true);
    }
    if (result.status !== 200) return announce(result.body.error, true);
    await loadSession(); chrome(M.parseRoute(location.hash));
    control.textContent = 'In your library';
    announce(previewMode ? mod.name + ' added to your preview library. Nothing is installed.'
      : mod.name + (result.body.game_online ? ' queued for your game.' : ' queued until your game connects.') + ' Review permissions in Cinnabar before enabling it.');
  }

  /** Enable or disable every library removal control on the page. */
  function setRemovalDisabled(disabled) {
    app.querySelectorAll('[data-focus-key^="remove:"]').forEach(control => { control.disabled = disabled; });
  }

  /** Remove the displayed send request without letting stale actions replace a later route or identity. */
  async function removeFromLibrary(selection, control) {
    if (removingLibrary || control.disabled || !session.account) return;
    removingLibrary = true;
    control.textContent = 'Removing…';
    setRemovalDisabled(true);
    const owner = session.account.id;
    const token = generation;
    try {
      const result = await call('POST', '/mods/' + encodeURIComponent(selection.slug) + '/remove', {
        sha256: selection.sha256, sent_at: selection.sent_at,
      });
      if (owner !== session.account?.id || token !== generation) return;
      if (result.status !== 200 && result.status !== 409) return announce(result.body.error, true);
      const refreshed = await loadSession(token);
      if (refreshed.stale) return;
      if (refreshed.status !== 200) return announce(result.status === 200
        ? 'Removed from your library. Refresh the page to load your current library.' : refreshed.body.error, true);
      await render();
      if (owner !== session.account?.id || generation !== token + 1) return;
      announce(result.status === 409 ? result.body.error : previewMode
        ? 'Removed from your preview library.' : 'Removed from your library. Manage installed mods in Cinnabar.', result.status === 409);
    } finally {
      removingLibrary = false;
      control.textContent = 'Remove from library';
      setRemovalDisabled(false);
    }
  }

  /** Render category browsing and the saved library with search state retained. */
  async function catalogue(token, libraryOnly) {
    if (libraryOnly) {
      const current = await loadSession(token);
      if (current.stale) return;
      if (current.status !== 200) return mount(token, failure(current.body.error));
      chrome(M.parseRoute(location.hash));
    }
    const response = await call('GET', '/mods');
    if (token !== generation) return;
    if (response.status !== 200) return mount(token, failure(response.body.error));
    const mods = response.body;
    const saved = new Set(session.library.filter(item => !item.pulled).map(item => item.slug));
    const entries = libraryOnly ? mods.filter(mod => saved.has(mod.slug)).concat(
      session.library.filter(item => item.pulled || !mods.some(mod => mod.slug === item.slug)).map(selection => ({
        slug: selection.slug, name: selection.slug, capabilities: [], unavailable: true, selection,
      }))) : mods;
    const rail = h('aside', { 'aria-label': 'Filter mods' });
    const grid = h('div', { class: 'catalog-grid', 'aria-label': libraryOnly ? 'Saved mods' : 'Mod results' });
    const count = h('span', { class: 'small muted', role: 'status' });
    const search = h('input', { id: 'mod-search', type: 'search', placeholder: 'Search mods', value: filters.query,
      'aria-label': 'Search mods', 'data-focus-key': 'catalog:search', oninput: event => { filters.query = event.target.value; results(true); } });
    const sort = h('select', { 'aria-label': 'Sort mods', onchange: event => { filters.order = event.target.value; results(true); } },
      D.SORTS.map(item => h('option', { value: item.value }, item.label)));
    sort.value = filters.order;
    const categoryButtons = ['all', ...C.CATEGORIES].map(category =>
      [category, button('', () => { filters.category = category; results(true); }, '', 'category:' + category)]);
    rail.append(h('div', { class: 'filter-section' }, h('p', { class: 'filter-title' }, 'Categories'),
      h('div', { class: 'filters' }, categoryButtons.map(([, control]) => control))),
    h('div', { class: 'filter-section' },
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: filters.limited, onchange: event => { filters.limited = event.target.checked; results(true); } }), 'No gameplay changes')));
    const clear = button('Clear filters', () => {
      filters = D.read('#/'); search.value = ''; sort.value = filters.order;
      rail.querySelector('input[type="checkbox"]').checked = false; results(true);
    }, 'quiet catalog-clear', 'catalog:clear');

    /** Update just the results, keeping search, filter focus and selection intact. */
    function results(persist = false) {
      if (persist) history.replaceState(null, '', D.url(libraryOnly ? 'library' : 'catalogue', filters));
      document.querySelectorAll('[data-filter-route]').forEach(link => { link.setAttribute('href', D.url(link.getAttribute('data-filter-route'), filters)); });
      const visible = D.select(entries, filters);
      const counts = D.counts(entries, filters);
      categoryButtons.forEach(([category, control]) => {
        const label = category === 'all' ? 'All mods' : category;
        control.replaceChildren(h('span', {}, label), h('span', { class: 'filter-count', 'aria-hidden': 'true' }, counts[category]));
        control.setAttribute('aria-label', label + ', ' + counts[category] + (counts[category] === 1 ? ' mod' : ' mods'));
        control.className = category === filters.category ? 'active' : ''; control.setAttribute('aria-pressed', String(category === filters.category));
      });
      clear.hidden = !filters.query && filters.category === 'all' && !filters.limited && filters.order === 'recommended';
      grid.replaceChildren(...visible.map(mod => mod.unavailable ? h('article', { class: 'mod-card' }, h('h3', {}, mod.slug),
        h('p', {}, 'This release is unavailable. It may have been hidden or revoked.'), removalControl(mod.selection)) : h('article', { class: 'mod-card' },
        h('div', { class: 'mod-result' }, modIcon(mod),
          h('div', { class: 'mod-card-title' }, h('h3', {}, h('a', { href: '#/mod/' + mod.slug, 'data-focus-key': 'mod:' + mod.slug }, mod.name)),
            h('span', { class: 'small muted' }, 'by ' + mod.creator_name)),
          h('p', { class: 'mod-card-summary' }, mod.summary),
          h('span', { class: 'mod-category' }, C.category(mod)),
          h('span', { class: 'release-version', 'aria-label': 'Version ' + mod.version }, mod.version)),
        libraryOnly ? removalControl(session.library.find(item => item.slug === mod.slug), 'btn quiet library-remove') : null)));
      const total = grid.querySelectorAll('.mod-card').length;
      count.textContent = total + ' mod' + (total === 1 ? '' : 's');
      if (!grid.childNodes.length) grid.append(h('div', { class: 'empty' }, h('h2', {}, libraryOnly ? 'Your library is empty.' : 'No mods match.'),
        h('p', {}, libraryOnly ? 'Explore the catalogue and inspect a mod before adding it.' : 'Try another search or category.'),
        button('Clear filters', () => clear.click(), 'btn quiet', 'catalog:recovery')));
    }
    const content = h('div', { class: 'catalog-results' }, h('div', { class: 'search-tools' }, h('label', { class: 'search-wrap' }, icon('search'), search), sort),
      h('div', { class: 'catalog-count' }, libraryOnly ? h('h2', {}, 'Your library') : null, count, clear),
      libraryOnly ? h('p', { class: 'small muted' }, 'Removing a library selection stops queued delivery. Manage installed mods in Cinnabar.') : null, grid);
    mount(token, h('section', { class: 'catalog-layout' }, rail, content)); results();
    if (libraryOnly && !session.account) announce('Choose an account to keep a library. Browsing is public.');
  }

  /** Bind removal to the exact saved selection, including unavailable catalogue entries. */
  function removalControl(selection, className = 'btn quiet') {
    const control = button('Remove from library', () => removeFromLibrary(selection, control), className, 'remove:' + selection.slug);
    control.disabled = removingLibrary;
    return control;
  }

  /** Draw a project page with gallery, safe description, versions and permissions. */
  async function project(token, route) {
    const response = await call('GET', '/mods/' + encodeURIComponent(route.slug));
    if (response.status !== 200) return mount(token, failure(response.body.error));
    const mod = response.body;
    const content = h('div');
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Project information' });
    const add = button('Add to Cinnabar', () => addToLibrary(mod, add), 'cta full', 'project:add');
    const sidebar = h('aside', { class: 'stack project-sidebar' },
      h('section', { class: 'sidebox' }, add,
        h('p', { class: 'small muted install-caption' }, 'Enable it in Settings → Mods.'),
        h('dl', { class: 'fact-list' }, h('div', {}, h('dt', {}, 'Version'), h('dd', {}, mod.version)),
          h('div', {}, h('dt', {}, 'License'), h('dd', {}, mod.license || 'Not provided')))),
      h('details', { class: 'sidebox permission-disclosure' }, h('summary', {}, 'Permissions (' + (mod.capabilities || []).length + ')'),
        h('p', { class: 'small muted' }, 'You choose what to allow in Cinnabar.'), permissions(mod, mod.grants)),
      M.atLeast(session.account, 'moderator') && mod.version_id ? h('a', { class: 'btn quiet', href: '#/staff/queue/' + mod.version_id }, 'Review this release') : null,
      button('Report a concern', () => reportForm(mod, content), 'btn quiet report-link', 'project:report'));
    /** Keep the selected information tab local so it does not discard catalogue state. */
    function select(tab) {
      buttons.forEach(([name, control]) => control.classList.toggle('active', name === tab));
      if (tab === 'versions') {
        content.replaceChildren(h('h2', {}, 'Releases'), h('div', { class: 'table-wrap gap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', {}, 'Status'), h('th', {}, 'Reviewed by'), h('th', {}, 'Release notes'))),
          h('tbody', {}, (mod.history || []).map(version => h('tr', {}, h('td', {}, version.version),
            h('td', {}, version.pulled ? 'Pulled' : version.publication === 'automatic' ? 'Published automatically' : 'Approved'),
            h('td', {}, (version.reviewers || []).join(', ') || (version.publication === 'automatic' ? 'Automatic checks' : 'Not provided')), h('td', {}, version.notes || 'Not provided')))))));
      } else if (tab === 'permissions') {
        content.replaceChildren(h('h2', {}, 'Permissions & checks'), permissions(mod, mod.grants),
          scanEvidence(mod),
          h('dl', { class: 'facts' }, h('dt', {}, 'SHA-256'), h('dd', {}, mod.sha256), h('dt', {}, 'Size'), h('dd', {}, mod.bytes + ' bytes')));
      } else {
        content.replaceChildren(galleryView(mod), C.markdown(document, mod.description));
        const source = C.externalUrl(mod.source);
        if (source) content.append(h('a', { class: 'btn quiet gap', href: source, rel: 'noopener noreferrer' }, 'View source'));
      }
    }
    const buttons = [['description', 'Overview'], ['versions', 'Versions'], ['permissions', 'Permissions']]
      .map(([name, label]) => [name, button(label, () => select(name), '', 'detail:' + name)]);
    tabs.append(...buttons.map(([, control]) => control));
    select('description');
    mount(token, h('section', {}, h('a', { class: 'back', href: D.url('catalogue', filters) }, 'Back to mods'),
      h('div', { class: 'project-heading' }, modIcon(mod), h('div', {}, h('h1', {}, mod.name), h('p', {}, mod.summary),
        h('div', { class: 'tags' }, h('span', { class: 'small muted' }, 'by ' + mod.creator_name), h('span', { class: 'tag' }, C.category(mod))))), tabs, h('div', { class: 'detail-layout' }, content, sidebar)));
    document.title = mod.name + ' · Cinnabar';
  }

  /** Report a selected release with a labelled inline form and server error recovery. */
  function reportForm(mod, content) {
    if (!session.account) return signIn();
    const reason = h('select', { id: 'report-reason' }, M.REPORT_REASONS.map(value => h('option', { value }, value)));
    const details = h('textarea', { id: 'report-details', minlength: 10, maxlength: 1000, required: true });
    const error = h('p', { class: 'error', role: 'alert' });
    content.replaceChildren(h('h2', {}, 'Report ' + mod.name), h('form', { class: 'gap', onsubmit: async event => {
      event.preventDefault();
      const result = await call('POST', '/mods/' + encodeURIComponent(mod.slug) + '/reports', { reason: reason.value, details: details.value });
      if (result.status !== 200) { error.textContent = result.body.error; return; }
      announce('Report received.'); render();
    } }, h('label', { class: 'field', for: 'report-reason' }, 'Reason', reason),
    h('label', { class: 'field', for: 'report-details' }, 'What happened?', details), error, h('button', { class: 'btn primary', type: 'submit' }, 'Send report')));
    reason.focus();
  }

  const draftKey = owner => 'cinnabar.marketplace.draft.' + owner;

  /** Restore only draft fields for this account; artifact bytes are never stored in browser storage. */
  function loadDraft() {
    const owner = session.account.id;
    if (draft && owner === draftOwner) return;
    draftOwner = owner;
    let saved;
    try { saved = JSON.parse(storage.getItem(draftKey(owner))); } catch (_) { saved = null; }
    const initial = { name: '', slug: '', summary: '', description: '', category: '', license: '', version: '', source: '', notes: '' };
    draft = Object.assign(initial, saved && typeof saved === 'object' ? Object.fromEntries(Object.keys(initial).map(key => [key, typeof saved[key] === 'string' ? saved[key] : initial[key]])) : {});
    draft.file = null; draft.parsed = null; draft.check = null;
    draft.images = U.restoreImages(saved?.images);
    draft.pending_upload = Boolean(saved?.pending_upload);
    if (draft.pending_upload) uploadStatus = { error: 'Your previous upload may have been received. Reselect your files; retry checks Your projects first.' };
  }

  /** Save this account's editable draft; quota failure leaves the current form intact. */
  function saveDraft(quiet = false) {
    const data = { ...draft }; delete data.file; delete data.parsed; delete data.check;
    data.images = draft.images.map(({ sha256, name, caption, alt }) => ({ sha256, name, caption, alt }));
    try { storage.setItem(draftKey(draftOwner), JSON.stringify(data)); if (quiet !== true) announce('Draft saved in this browser. Reselect files after reloading.'); }
    catch (_) { announce('Browser storage is unavailable or full. Your current draft remains open; enable storage and retry.', true); }
  }

  /** Decode screenshots before previewing, and restore a reselected file to its saved gallery position. */
  async function takeImages(files) {
    if (imagesPending || submitting || !U.validLimits(session.upload_limits)) return;
    const owner = draftOwner, token = ++imageGeneration;
    const limits = session.upload_limits;
    imagesPending = true;
    const selected = draft.images.map(image => ({ ...image }));
    await render();
    let error;
    try {
      for (const file of files) {
        const image = await U.prepareImage(file, limits);
        if (owner !== draftOwner || token !== imageGeneration) return;
        const existing = selected.find(item => item.sha256 === image.sha256);
        if (existing) Object.assign(existing, image, { caption: existing.caption, alt: existing.alt });
        else {
          if (selected.length >= limits.images) throw new Error('Choose at most ' + limits.images + ' screenshots.');
          selected.push(image);
        }
      }
      for (const image of selected) {
        const currentImage = draft.images.find(item => item.sha256 === image.sha256);
        if (currentImage) Object.assign(image, { caption: currentImage.caption, alt: currentImage.alt });
      }
      draft.images = selected; clearEditorError('images');
    } catch (failure) { error = failure.message || 'The screenshots could not be read.'; }
    finally {
      if (owner === draftOwner && token === imageGeneration) {
        imagesPending = false;
        if (error) await showEditorErrors({ ...editorErrors, images: error }); else await render();
      }
    }
  }

  /** Keep screenshot order, captions and accessible descriptions editable without changing the component icon. */
  function galleryEditor() {
    const limits = session.upload_limits;
    const available = U.validLimits(limits);
    const input = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp', disabled: !available || imagesPending,
      onchange: event => takeImages(Array.from(event.target.files || [])) });
    const section = h('section', { class: 'gallery-editor gap' }, h('label', { class: 'field', for: 'draft-images' },
      h('span', { class: 'field-label' }, 'Screenshots', requirement('images')), input,
      fieldFeedback('images', input, available ? 'Up to ' + limits.images + ' still images · ' + Math.floor(limits.image_bytes / 1024) + ' KiB each · PNG, JPEG or WebP.'
        : 'Reload after the API update to enable screenshot uploads.')));
    if (imagesPending) section.append(h('p', { role: 'status', class: 'small muted' }, 'Preparing screenshots…'));
    /** Return keyboard focus to the moved image or the file chooser after gallery changes. */
    async function focusImage(hash) {
      await render();
      const control = [...app.querySelectorAll('[data-image-caption]')].find(item => item.getAttribute('data-image-caption') === hash);
      (control || document.getElementById('draft-images'))?.focus();
    }
    section.append(h('ol', { class: 'gallery-editor-list' }, draft.images.map((image, index) => {
      const row = h('li', { class: 'gallery-editor-item' }, image.url ? h('img', { src: image.url, alt: '', class: 'gallery-editor-preview' })
        : h('p', { class: 'small muted gallery-editor-preview' }, 'Reselect ' + image.name), h('div', {}, h('p', { class: 'small' }, (index + 1) + '. ' + image.name)));
      const body = row.lastChild;
      for (const [key, label, max] of [['caption', 'Caption', limits?.caption_chars], ['alt', 'Image description', limits?.alt_chars]]) {
        const control = h('input', { type: 'text', value: image[key], maxlength: max,
          'data-image-caption': key === 'caption' ? image.sha256 : null, 'data-focus-key': 'image:' + image.sha256 + ':' + key,
          oninput: event => { image[key] = event.target.value; clearEditorError('images'); } });
        body.append(h('label', { class: 'field small' }, h('span', { class: 'field-label' }, label, requirement(key)), control));
      }
      const earlier = button('Move earlier', () => {
        draft.images.splice(index - 1, 0, draft.images.splice(index, 1)[0]); focusImage(image.sha256);
      }, 'quiet', 'image:' + image.sha256 + ':earlier'); earlier.disabled = index === 0 || imagesPending;
      const later = button('Move later', () => {
        draft.images.splice(index + 1, 0, draft.images.splice(index, 1)[0]); focusImage(image.sha256);
      }, 'quiet', 'image:' + image.sha256 + ':later'); later.disabled = index === draft.images.length - 1 || imagesPending;
      const remove = button('Remove', () => {
        draft.images.splice(index, 1); clearEditorError('images'); focusImage(draft.images[index]?.sha256 || draft.images[index - 1]?.sha256);
      }, 'quiet', 'image:' + image.sha256 + ':remove'); remove.disabled = imagesPending;
      for (const control of [earlier, later, remove]) control.setAttribute('aria-label', control.textContent + ' screenshot ' + (index + 1));
      body.append(h('div', { class: 'row gallery-edit-actions' }, earlier, later, remove));
      return row;
    })));
    return section;
  }

  /** Show byte progress separately from server confirmation; a completed transfer is not a published release. */
  function uploadView() {
    const progress = h('progress', { id: 'upload-progress', max: 1, 'aria-label': 'Release upload' });
    const label = h('p', { id: 'upload-progress-label', role: 'status', class: 'small muted' });
    const view = h('section', { class: 'upload-status' }, h('h2', {}, uploadStatus?.recovering ? 'Checking your previous upload…' : 'Uploading your release…'),
      h('p', {}, draft?.file?.name || 'Release component'), progress, label,
      h('p', { class: 'small muted' }, 'Keep this tab open. Your draft and selected files stay available if the upload is interrupted.'),
      button('Stop upload', () => uploadController?.abort(), 'btn quiet', 'upload:stop'));
    updateUploadProgress(view);
    return view;
  }

  /** Progress events update only the connected status display for this upload. */
  function updateUploadProgress(container = app) {
    const progress = container.querySelector('#upload-progress'), label = container.querySelector('#upload-progress-label');
    if (!progress || !label) return;
    if (uploadStatus?.total > 0) {
      const ratio = Math.max(0, Math.min(1, uploadStatus.loaded / uploadStatus.total));
      progress.value = ratio;
      label.textContent = ratio === 1 ? 'Upload sent. Waiting for server confirmation…' : Math.floor(ratio * 100) + '% uploaded';
    } else {
      progress.removeAttribute('value'); label.textContent = uploadStatus?.recovering ? 'Checking whether the release was received.' : 'Sending your files…';
    }
  }

  /** Check both declarations and the complete component before accepting a release file. */
  async function takeFile(file) {
    validationController?.abort();
    validationController = new AbortController();
    const signal = validationController.signal;
    const token = ++fileToken;
    const owner = draftOwner;
    validationPending = true; draft.file = null; draft.parsed = null; draft.check = null;
    announce('Checking the component structure. Uploaded code is not executed.');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The file is over 16 MiB.');
      const bytes = await file.arrayBuffer();
      const parsed = M.readComponent(bytes);
      const extractedIcon = await window.CinnabarValidation.iconUrl(parsed.icon);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const check = await window.CinnabarValidation.validate(bytes.slice(0), { signal });
      if (token !== fileToken || owner !== draftOwner) return;
      draft.file = file; draft.parsed = { ...parsed, icon: extractedIcon, sha256: digest, bytes: file.size }; draft.check = check;
      for (const key of ['name', 'version', 'description']) if (!draft[key]) draft[key] = parsed[key] || '';
      if (!draft.summary) draft.summary = parsed.description.slice(0, 140);
      announce('Component syntax checks passed. This is not a malware scan.');
    } catch (error) {
      if (token === fileToken && owner === draftOwner) editorErrors.file = error.message || String(error);
    } finally {
      if (token === fileToken && owner === draftOwner) {
        validationPending = false;
        if (editorErrors.file) await showEditorErrors({ ...editorErrors }); else render();
      }
    }
  }

  const requiredFields = new Set(['name', 'summary', 'version', 'file', 'rights']);
  const projectFields = ['name', 'slug', 'summary', 'description', 'category', 'license', 'source'];

  /** Locate errors in editor order. */
  function fieldStep(key) {
    return projectFields.includes(key) ? 'project' : key === 'rights' ? 'checks' : 'release';
  }

  /** Present a field error on its step and bring the first invalid control into view. */
  async function showEditorErrors(errors) {
    editorErrors = errors;
    step = steps.find(name => Object.keys(errors).some(key => fieldStep(key) === name)) || step;
    await render();
    const first = app.querySelector('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    const count = Object.keys(errors).length;
    announce('Fix ' + count + (count === 1 ? ' field' : ' fields') + ' to continue.', true);
  }

  /** Clear only the edited field's error, preserving its format hint and focused DOM node. */
  function clearEditorError(key) {
    const hadError = Object.hasOwn(editorErrors, key);
    delete editorErrors[key];
    const control = document.getElementById(key === 'rights' ? 'distribution-rights' : 'draft-' + key);
    control?.removeAttribute('aria-invalid');
    const described = control?.getAttribute('aria-describedby')?.split(' ').filter(id => id !== 'error-' + key);
    if (described?.length) control.setAttribute('aria-describedby', described.join(' '));
    else control?.removeAttribute('aria-describedby');
    document.getElementById('error-' + key)?.remove();
    const count = Object.keys(editorErrors).length;
    if (!count) announce('');
    else if (hadError) announce('Fix ' + count + (count === 1 ? ' field' : ' fields') + ' to continue.', true);
  }

  /** Give every editor control the same explicit requirement label. */
  function requirement(key) {
    return h('span', { class: 'field-requirement' }, requiredFields.has(key) ? 'Required' : 'Optional');
  }

  /** Attach persistent helper and error text to a control for visual and screen reader use. */
  function fieldFeedback(key, control, hint = '') {
    control.id = key === 'rights' ? 'distribution-rights' : 'draft-' + key;
    const error = editorErrors[key];
    const ids = [hint ? 'hint-' + key : '', error ? 'error-' + key : ''].filter(Boolean);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    if (error) control.setAttribute('aria-invalid', 'true');
    if (requiredFields.has(key)) control.setAttribute('aria-required', 'true');
    return [hint ? h('span', { class: 'hint', id: 'hint-' + key }, hint) : null,
      error ? h('span', { class: 'field-error', id: 'error-' + key }, error) : null];
  }

  /** Build the creator's three-step editor, keeping every local field across step changes. */
  async function editor(token) {
    if (!session.account) return mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Give your mod a home.'),
      h('p', {}, 'Sign in to prepare a project and submit a release.'), button(previewMode ? 'Choose a preview account' : 'Sign in with Google', signIn, 'btn primary', 'editor:signin')));
    if (!session.account.username) {
      mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Choose a username to publish.'),
        h('p', {}, 'Your username appears on your projects.'), button('Choose a username', openUsername, 'btn primary', 'editor:username')));
      return;
    }
    if (submitting) return mount(token, uploadView());
    loadDraft();
    const form = h('form', { class: 'editor', novalidate: true });
    const panel = h('div');
    if (uploadStatus?.error) form.append(h('p', { class: 'notice upload-recovery', role: 'status' }, uploadStatus.error,
      ' ', h('a', { href: '#/mine' }, 'Your projects')));
    const previewName = h('h3', {}, draft.name || 'Your mod');
    const previewSummary = h('p', {}, draft.summary || 'Your summary appears here.');
    const preview = h('aside', { class: 'editor-aside' }, h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Listing preview'),
      h('div', { class: 'preview-card' }, modIcon({ capabilities: [], category: draft.category, icon: draft.parsed?.icon }), previewName,
        h('span', { class: 'small muted' }, session.account.username), previewSummary),
      h('p', { class: 'rule small muted' }, 'Drafts are private to this account in this browser. Nothing is published until the service approves a release.'));
    const stepButtons = steps.map((name, index) => h('li', {}, button(h('span', { class: 'row' }, h('span', { class: 'num' }, index + 1),
      ['Project', 'Release', 'Checks & publish'][index]), () => { step = name; render(); }, step === name ? 'active' : '', 'step:' + name)));
    const addressPreview = h('span', { class: 'hint address-preview', id: 'address-preview' });
    /** Show the actual hash route used by listing links, with a useful empty-state instruction. */
    function updateAddressPreview() {
      const slug = M.listingSlug(draft);
      addressPreview.textContent = slug ? 'cinnabar.gg/mods/#/mod/' + slug : 'Enter a project name to preview its address.';
    }
    updateAddressPreview();
    /** Bind a labelled input to the draft without replacing focused controls. */
    function field(key, label, type = 'text', hint = '') {
      const input = h(type === 'textarea' ? 'textarea' : 'input', { id: 'draft-' + key, name: key, type: type === 'textarea' ? null : type,
        value: draft[key], inputmode: key === 'source' ? 'url' : null,
        oninput: event => {
          const control = event.target;
          if (key === 'slug' && !event.isComposing) {
            const value = control.value;
            const start = control.selectionStart, end = control.selectionEnd;
            control.value = M.normalizeAddress(value);
            if (start !== null && end !== null && control.setSelectionRange) {
              control.setSelectionRange(M.normalizeAddress(value.slice(0, start)).length, M.normalizeAddress(value.slice(0, end)).length);
            }
          }
          draft[key] = control.value;
          clearEditorError(key);
          if (key === 'name') { previewName.textContent = draft.name; if (!draft.slug.trim()) clearEditorError('slug'); }
          if (key === 'summary') previewSummary.textContent = draft.summary;
          if (key === 'name' || key === 'slug') updateAddressPreview();
        } });
      if (key === 'slug') {
        input.setAttribute('autocapitalize', 'none'); input.setAttribute('spellcheck', 'false');
        input.addEventListener('compositionend', () => {
          const event = document.createEvent('Event'); event.initEvent('input', true, false); input.dispatchEvent(event);
        });
      }
      const feedback = fieldFeedback(key, input, hint);
      if (key === 'slug') input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), 'address-preview'].filter(Boolean).join(' '));
      return h('label', { class: 'field', for: 'draft-' + key }, h('span', { class: 'field-label' }, label, requirement(key)), input, feedback, key === 'slug' ? addressPreview : null);
    }
    if (step === 'project') {
      panel.append(h('h2', {}, 'Tell players what it does.'), field('name', 'Project name', 'text', '1–64 characters.'), field('slug', 'Project address', 'text', 'Leave blank to use the project name. Custom addresses use 3–40 letters, numbers and dashes.'),
        field('summary', 'Summary', 'text', 'One clear sentence shown in search results. 10–140 characters.'), field('description', 'Description', 'textarea', 'Markdown headings, lists, bold text, code and HTTPS links are supported. HTML stays plain text.'));
      const select = h('select', { id: 'draft-category', onchange: event => { draft.category = event.target.value; clearEditorError('category'); preview.querySelector('.mod-icon').replaceWith(modIcon({ category: draft.category, icon: draft.parsed?.icon })); } },
        h('option', { value: '' }, 'No category'), C.CATEGORIES.map(name => h('option', { value: name }, name)));
      select.value = draft.category;
      panel.append(h('div', { class: 'two gap' }, h('label', { class: 'field', for: 'draft-category' }, h('span', { class: 'field-label' }, 'Category', requirement('category')), select, fieldFeedback('category', select)), field('license', 'License', 'text', 'For example MIT or All rights reserved.')),
        field('source', 'Source repository', 'text', 'Optional. Link a GitHub repository if you want players to see the code.'));
    } else if (step === 'release') {
      const fileInput = h('input', { type: 'file', accept: '.wasm', 'aria-label': 'Choose mod component',
        onchange: event => { clearEditorError('file'); const file = event.target.files?.[0]; if (file) takeFile(file); } });
      panel.append(h('h2', {}, 'Add a release.'), h('div', { class: 'upload-zone' }, icon('upload'), h('label', { class: 'field-label', for: 'draft-file' }, validationPending ? 'Checking component…' : 'Choose your Wasm component', requirement('file')),
        h('span', { class: 'small muted' }, 'Portable .wasm component · up to 16 MiB'), fileInput, fieldFeedback('file', fileInput)),
      draft.file ? h('p', { class: 'small good gap' }, draft.file.name + ' · syntax checked') : h('p', { class: 'small muted gap' }, 'Select a file for this session. No uploaded code is executed.'),
      field('version', 'Version', 'text', 'Use SemVer, for example 1.2.0.'), field('notes', 'Release notes', 'textarea'));
      panel.append(h('p', { class: 'hint', id: 'component-icon-status' }, draft.parsed
        ? (draft.parsed.icon ? 'Icon: from your mod file. ' : 'No icon in your mod file; the category icon is used. ')
        : 'Your mod file can include its own icon. ',
        h('a', { href: '/docs/modding/appendix/personal-mods.html#single-file-resources' }, 'How to add an icon')));
      if (draft.parsed) panel.append(permissions({ capabilities: M.requestedCapabilities(draft.parsed.grants) }, draft.parsed.grants));
      panel.append(galleryEditor());
    } else {
      const checked = Boolean(draft.file && draft.parsed && draft.check);
      const rights = h('input', { type: 'checkbox', id: 'distribution-rights', checked: distributionRights,
        onchange: event => { distributionRights = event.target.checked; clearEditorError('rights'); } });
      panel.append(h('h2', {}, 'Ready to submit'), h('p', { class: 'small muted' }, 'After you upload, we check your mod. A reviewer approves it before it goes live, and you can follow its status in Your projects.'),
        h('div', { class: 'scan-status' },
          h('div', {}, h('span', {}, 'Your mod file'), h('span', { class: checked ? 'good' : 'warning' }, checked ? '✓ Looks good' : validationPending ? 'Checking…' : 'Choose a file')),
          h('div', {}, h('span', {}, 'Review'), h('span', { class: 'muted' }, 'After upload'))));
      if (previewMode) panel.append(h('p', { class: 'notice gap' }, 'This is a preview. Your submission stays in this browser and will not go live.'));
      panel.append(h('label', { class: 'row gap small', for: 'distribution-rights' }, rights,
          h('span', {}, 'I have permission to share this mod. ', requirement('rights'))), ...fieldFeedback('rights', rights).filter(Boolean));
    }
    const submitLabel = liveMode ? 'Upload release' : 'Submit for review';
    form.append(panel, h('div', { class: 'editor-actions' }, button('Save draft', saveDraft, 'btn quiet', 'draft:save'),
      h('button', { type: 'submit', class: 'btn primary', 'data-focus-key': 'draft:continue', disabled: validationPending || imagesPending || submitting },
        submitting ? 'Uploading…' : step === 'checks' ? (uploadStatus?.error ? 'Retry upload' : submitLabel) : ['Continue to release', 'Review checks'][steps.indexOf(step)])));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!requireUsername()) return;
      if (validationPending || imagesPending || submitting) return announce('Wait for the current upload or file check to finish.', true);
      const fields = { name: draft.name.trim(), slug: M.listingSlug(draft), summary: draft.summary.trim(), description: draft.description.trim(),
        version: draft.version.trim(), source: draft.source.trim().replace(/\/$/, ''), category: draft.category.trim(), license: draft.license.trim(), notes: draft.notes.trim(),
        reach: M.reachOf(draft.parsed?.grants) };
      // Validate the blank address before resolving it so a failed derivation has actionable copy.
      const errors = M.validateListing({ ...fields, slug: draft.slug });
      if (!draft.file || !draft.parsed || !draft.check) errors.file = 'Choose a valid component file first.';
      if (draft.images.length) {
        const limits = session.upload_limits;
        if (!U.validLimits(limits)) errors.images = 'Reload to retrieve screenshot upload limits.';
        else if (draft.images.length > limits.images || draft.images.some(image => !image.file || image.file.size > limits.image_bytes
          || image.caption.length > limits.caption_chars || image.alt.length > limits.alt_chars)) {
          errors.images = 'Reselect missing screenshots and check their caption and image-description lengths.';
        }
      }
      if (step === 'checks') {
        distributionRights = document.getElementById('distribution-rights').checked;
        if (!distributionRights) errors.rights = 'Confirm your distribution rights before submitting.';
      }
      const currentErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => step === 'checks' || fieldStep(key) === step));
      if (Object.keys(currentErrors).length) return showEditorErrors(currentErrors);
      if (step !== 'checks') { step = steps[steps.indexOf(step) + 1]; await render(); announce(''); return; }
      editorErrors = {};
      const recovering = draft.pending_upload;
      const attempt = { owner: draftOwner, fields, sha256: draft.parsed.sha256, images: draft.images.map(image => ({ ...image })) };
      const file = draft.file;
      draft.pending_upload = true; saveDraft(true);
      submitting = true; uploadStatus = { recovering, loaded: 0, total: null };
      uploadController = new AbortController();
      const controller = uploadController;
      const upload = ++uploadGeneration;
      const owner = draftOwner;
      const startedAt = location.hash;
      await render();
      const current = () => upload === uploadGeneration && owner === draftOwner;
      /** A lost response can be recovered only from this creator's matching immutable release. */
      async function recover() {
        const known = await call('GET', '/me/mods', undefined, { signal: controller.signal });
        if (!current() || controller.signal.aborted) return { status: 0, body: { error: 'Upload stopped. Your files are still selected; retry to check whether it was received.' } };
        if (known.status !== 200) return { ...known, uncertain: true };
        const received = U.receipt(known.body, attempt);
        return received ? { status: 200, body: received } : null;
      }
      let result;
      try {
        if (recovering) result = await recover();
        if (!current()) return;
        if (!result && !controller.signal.aborted) {
          uploadStatus.recovering = false; updateUploadProgress();
          result = backend.submit ? await backend.submit(fields, file, { images: attempt.images, signal: controller.signal,
            onProgress: progress => { if (current()) { Object.assign(uploadStatus, progress); updateUploadProgress(); } } }) : await call('POST', '/submissions', {
            ...fields, grants: draft.parsed.grants || {}, sha256: draft.parsed.sha256, bytes: file.size,
          });
          if (result.status === 409) result = await recover() || result;
        }
      } catch (_) { result = { status: 0, body: { error: controller.signal.aborted
        ? 'Upload stopped. Retry checks whether the release was received.' : 'Connection lost. Your files are still selected. Retry checks whether the release was received.' } }; }
      if (!current()) return;
      submitting = false;
      uploadController = null;
      result ||= { status: 0, body: { error: 'Upload stopped. Retry checks whether the release was received.' } };
      if (result.status === 200 && !U.receipt([result.body], attempt)) {
        result = { status: 502, body: { error: 'The upload was not confirmed. Your files are still selected; retry checks Your projects first.' } };
      }
      if (result.status !== 200) {
        draft.pending_upload = Boolean(result.uncertain) || result.status === 0 || result.status === 408 || result.status >= 500;
        saveDraft(true);
        uploadStatus = { error: result.body.error || 'Upload failed. Retry with the selected files.' };
        if (M.parseRoute(location.hash).view === 'submit' && result.body.fields && Object.keys(result.body.fields).length) {
          return showEditorErrors(result.body.fields);
        }
        if (M.parseRoute(location.hash).view === 'submit') await render();
        return announce(result.body.error, true);
      }
      uploadStatus = null;
      announce(previewMode ? 'Preview release submitted for review. No file was distributed.' : 'Release uploaded. Follow its checks and publication status in Your projects.');
      try { storage.removeItem(draftKey(owner)); } catch (_) { /* A completed upload still succeeds if browser storage is unavailable. */ }
      draft = null; editorErrors = {}; distributionRights = false; step = 'project';
      if (location.hash === startedAt) location.hash = '#/mine' + (result.body?.id ? '/' + encodeURIComponent(result.body.id) : '');
    });
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('div', {}, h('h1', {}, 'Give your mod a home.'), h('p', { class: 'muted' }, 'Publishing as ' + session.account.username))),
      h('div', { class: 'editor-layout' }, h('aside', {}, h('ol', { class: 'steps' }, stepButtons)), form, preview)));
  }

  /** Display immutable submitted releases and any staff note without fabricating scans. */
  async function mine(token, route) {
    if (!session.account) return editor(token);
    const result = await call('GET', '/me/mods');
    if (result.status !== 200) return mount(token, failure(result.body.error));
    const selected = result.body.find(version => String(version.id) === route.id) || result.body[0];
    const details = selected ? h('details', { class: 'release-check-details', open: expandedChecks.has(String(selected.id)) },
      h('summary', { 'data-focus-key': 'checks:' + selected.id }, 'Check details'), scanEvidence(selected)) : null;
    if (details) details.addEventListener('toggle', () => {
      if (details.isConnected) { if (details.open) expandedChecks.add(String(selected.id)); else expandedChecks.delete(String(selected.id)); }
    });
    const detail = selected ? h('section', { class: 'release-detail gap' }, h('h2', {}, selected.name + ' ' + selected.version),
      releaseProgress(selected), details, selected.note ? h('p', { class: 'notice gap' }, 'Staff note: ' + selected.note) : null,
      h('div', { class: 'detail-layout gap' }, h('div', {}, galleryView(selected), C.markdown(document, selected.description)),
        h('div', {}, h('h3', {}, 'Requested permissions'), permissions(selected, selected.grants),
          h('dl', { class: 'facts' }, h('dt', {}, 'SHA-256'), h('dd', {}, selected.sha256))))) : null;
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('h1', {}, 'Your projects'), h('a', { href: '#/submit', class: 'btn primary' }, 'Prepare a release')),
      refreshControls(), result.body.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Project', 'Version', 'Progress', 'Staff note'].map(label => h('th', {}, label)))),
        h('tbody', {}, result.body.map(version => {
          const state = C.releaseState(version);
          return h('tr', {}, h('td', {}, h('a', { href: '#/mine/' + version.id }, version.name)), h('td', {}, version.version),
            h('td', { class: state.tone }, state.label), h('td', {}, version.note || '—'));
        })))) : h('p', { class: 'empty' }, 'No submitted releases yet. Your draft is available in Publish a mod.'), detail));
  }

  /** Report upload, scan, review and publication independently, using only confirmed server states. */
  function releaseProgress(version) {
    const state = C.releaseState(version);
    return h('div', { class: 'release-progress-wrap' }, h('p', { class: state.tone, role: 'status' }, state.label),
      h('ol', { class: 'release-progress', 'aria-label': 'Release progress' }, C.releaseTimeline(version).map((item, index) => {
        const description = { complete: 'complete', current: 'in progress', pending: 'not started', error: 'held' }[item.state];
        return h('li', { class: 'state-' + item.state, 'aria-current': item.state === 'current' ? 'step' : null,
          'aria-label': item.label + ': ' + description }, h('span', { class: 'progress-dot', 'aria-hidden': 'true' }, item.state === 'complete' ? '✓' : index + 1),
        h('span', {}, item.label));
      })));
  }

  /** Require staff identity and preserve each failed workspace request as an error state. */
  async function staff(token, route) {
    if (!M.atLeast(session.account, 'moderator')) return mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Review workspace'),
      h('p', {}, 'Sign in with a moderator or administrator account to continue.'), !session.account ? button('Sign in', signIn, 'btn primary') : null));
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Staff workspace' }, [['queue', 'Review queue'], ['reports', 'Reports'], ['people', 'People'], ['audit', 'Audit history']].map(([tab, label]) =>
      h('a', { href: '#/staff/' + tab, 'aria-current': route.tab === tab ? 'page' : null }, label)));
    const body = h('div');
    const response = await call('GET', '/staff/' + route.tab);
    if (response.status !== 200) body.append(failure(response.body.error));
    else if (route.tab === 'queue') await reviewQueue(body, response.body, route.id, token);
    else if (route.tab === 'reports') staffReports(body, response.body);
    else if (route.tab === 'people') staffPeople(body, response.body);
    else staffAudit(body, response.body);
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('div', {}, h('h1', {}, 'Review the evidence.'),
      h('p', { class: 'muted' }, 'Every decision is recorded. AI findings require evidence.'))), tabs, body));
  }

  /** Compute value-level changes from raw grants, ignoring an API's name-only diff. */
  function permissionDiff(version) {
    if (!version.previous) return null;
    return version.previous.grants ? M.grantDiff(version.previous.grants, version.grants) : version.previous.diff;
  }

  /** Build review evidence and role-checked actions for the selected exact release. */
  async function reviewQueue(body, queue, selected, token) {
    const refresh = refreshControls();
    if (refresh) body.append(refresh);
    if (!queue.length && !selected) { body.append(h('p', { class: 'empty' }, 'No versions are waiting for review.')); return; }
    const id = selected || queue[0].id;
    const result = await call('GET', '/staff/versions/' + encodeURIComponent(id));
    if (token !== generation) return;
    if (result.status !== 200) { body.append(failure(result.body.error)); return; }
    const version = result.body;
    const diff = permissionDiff(version);
    const noteKey = session.account.id + ':' + version.id;
    const notes = h('textarea', { id: 'review-note', 'data-focus-key': 'review:note', value: reviewNotes.get(noteKey) || '',
      placeholder: 'Explain the decision or requested change.', maxlength: 1000,
      oninput: event => { reviewNotes.set(noteKey, event.target.value); updateApprove(); } });
    const approve = M.can(session.account, 'approve', { version });
    if (approve.ok && version.previous && version.grants?.commands?.length && !version.previous.grants && !diff?.commands) {
      approve.ok = false;
      approve.reason = 'This API does not provide the previous command values. Upgrade the API before approving command-bearing updates.';
    }
    if (approve.ok && liveMode) Object.assign(approve, C.scanApproval(version));
    const allowed = M.can(session.account, 'review', { version });
    const decisionStatus = h('p', { class: 'error', role: 'alert' });
    /** Commit a review decision only to the selected version, retaining a failed note. */
    async function decide(decision, control) {
      if (!requireUsername()) return;
      control.disabled = true;
      const response = await call('POST', '/staff/versions/' + encodeURIComponent(version.id) + '/decision', { decision, note: notes.value });
      control.disabled = false;
      if (response.status !== 200) { decisionStatus.textContent = response.body.error; notes.focus(); return; }
      reviewNotes.delete(noteKey);
      location.hash = '#/staff/queue/' + version.id; await render(); announce('Review decision recorded for ' + version.name + ' ' + version.version + '.');
    }
    const decisions = h('div', { class: 'stack gap' });
    let approvalControl;
    /** A flagged finding needs an explicit explanation as well as the server's ready state. */
    function updateApprove() {
      if (approvalControl) approvalControl.disabled = !approve.ok || (version.scan?.report?.ai?.verdict === 'flag' && !notes.value.trim());
    }
    for (const [decision, label] of [['changes', 'Request changes'], ['approve', 'Approve release'], ['reject', 'Reject release']]) {
      const control = button(label, () => decide(decision, control), decision === 'changes' ? 'btn primary' : 'btn quiet', 'decision:' + decision);
      control.disabled = decision === 'approve' ? !approve.ok : !allowed.ok;
      if (decision === 'approve') approvalControl = control;
      decisions.append(control);
    }
    updateApprove();
    const trust = h('div');
    if (liveMode) {
      trust.append(h('p', { class: 'small gap' }, version.trust?.trusted
        ? 'Established creator for this project until ' + new Date(version.trust.expires_at).toLocaleDateString() + '.' : 'Automatic publication has not been established for this project.'));
      if (M.atLeast(session.account, 'admin') && version.creator !== session.account.id) {
        const key = noteKey + ':trust';
        const reason = h('input', { id: 'trust-reason', value: reviewNotes.get(key) || '', maxlength: 500, 'data-focus-key': 'review:trust-reason',
          oninput: event => reviewNotes.set(key, event.target.value) });
        trust.append(h('label', { class: 'field gap', for: 'trust-reason' }, 'Reason for changing creator trust', reason),
          button(version.trust?.trusted ? 'Revoke project trust' : 'Establish project trust', async () => {
            const result = await call('POST', '/staff/mods/' + encodeURIComponent(version.slug) + '/trust', { trusted: !version.trust?.trusted, reason: reason.value });
            if (result.status !== 200) { decisionStatus.textContent = result.body.error; reason.focus(); return; }
            reviewNotes.delete(key); await render(); announce('Project trust updated. The API still checks each release before publishing.');
          }, 'btn quiet', 'review:trust'), h('p', { class: 'hint' }, 'Requires a recent sign-in and a human-approved release. Trust is scoped to this creator and project.'));
      }
    }
    const state = C.releaseState(version);
    const review = h('div', {}, h('div', { class: 'review-top' }, h('div', {}, h('h2', {}, version.name + ' ' + version.version),
      h('p', { class: 'small muted' }, 'by ' + version.creator_name + (version.previous ? ' · Compare with ' + version.previous.version : ' · First release'))),
      h('span', { class: 'tag ' + state.tone }, state.label)),
    h('div', { class: 'review-columns' }, h('div', {},
      scanEvidence(version), h('h3', { class: 'gap' }, 'Submitted description'), C.markdown(document, version.description), galleryView(version),
      h('h3', { class: 'gap' }, 'Requested permissions'), permissions(version, version.grants),
      diff ? h('section', { class: 'rule' }, h('h3', {}, 'Changes from ' + version.previous.version),
        h('p', { class: 'small gap' }, 'Added: ' + (diff.added.join(', ') || 'None')),
        h('p', { class: 'small' }, 'Removed: ' + (diff.removed.join(', ') || 'None')),
        diff.commands ? h('div', { class: 'code-block gap' }, 'Commands added: ' + (diff.commands.added.join(', ') || 'None') + '\nCommands removed: ' + (diff.commands.removed.join(', ') || 'None'))
          : h('p', { class: 'warning small gap' }, 'This API response does not include command-value changes. Compare the exact grant lists before approving.'),
        diff.expanded ? h('p', { class: 'warning small gap' }, 'This release expands authority and cannot publish automatically.') : null) : null,
      h('dl', { class: 'facts' }, h('dt', {}, 'Artifact SHA-256'), h('dd', {}, version.sha256),
        h('dt', {}, 'Approvals'), h('dd', {}, version.approvals.map(person => person.username || 'Cinnabar player').join(', ') || 'None'),
        h('dt', {}, 'Source'), h('dd', {}, C.externalUrl(version.source) ? h('a', { href: C.externalUrl(version.source), rel: 'noopener noreferrer' }, version.source) : 'Not linked'))),
    h('aside', { class: 'verdict' }, h('h3', {}, 'Decision'), h('p', { class: 'small muted gap' }, approve.ok ? 'Compare the file, permissions and description before approving. Explain any AI flags in your note.' : approve.reason),
      backend.fileUrl && backend.fileUrl(version.id) ? h('a', { class: 'btn quiet gap', href: backend.fileUrl(version.id), rel: 'noopener noreferrer', target: '_blank' }, 'Download component') : null,
      h('label', { class: 'field gap', for: 'review-note' }, 'Note to creator', notes), decisions, decisionStatus,
      liveMode && version.status === 'submitted' ? button('Request a rescan', async () => {
        const response = await call('POST', '/staff/versions/' + encodeURIComponent(version.id) + '/rescan');
        if (response.status !== 200) { decisionStatus.textContent = response.body.error; return; }
        await render(); announce('New scan queued. Earlier scan claims and approvals were invalidated.');
      }, 'btn quiet', 'review:rescan') : null,
      trust,
      h('p', { class: 'small muted gap' }, 'No self-review. Every decision is tied to this version.'))));
    body.append(h('div', { class: 'review-layout' }, h('aside', { class: 'queue' }, queue.map(entry => h('a', {
      href: '#/staff/queue/' + entry.id, class: entry.id === id ? 'active' : '', 'data-focus-key': 'queue:' + entry.id,
    }, modIcon(entry), h('strong', {}, entry.name + ' ' + entry.version), h('span', { class: 'tag' }, M.RUNGS[entry.reach] || 'Unknown'),
    h('p', { class: 'small muted' }, entry.creator_name), h('p', { class: 'small' }, C.releaseState(entry).label)))), review));
  }

  /** Keep report triage and revocation actions visibly distinct from review approvals. */
  function staffReports(body, reports) {
    if (!reports.length) { body.append(h('p', { class: 'empty' }, 'No reports.')); return; }
    body.append(h('div', { class: 'stack' }, reports.map(report => {
      const note = h('textarea', { 'aria-label': 'Resolution for ' + report.name, maxlength: 2000 });
      const error = h('p', { class: 'error', role: 'alert' });
      const actions = h('div', { class: 'review-actions' });
      if (report.status !== 'resolved') actions.append(button('Resolve report', async () => {
        const result = await call('POST', '/staff/reports/' + report.id + '/resolve', { note: note.value });
        if (result.status !== 200) { error.textContent = result.body.error; return; } render(); announce('Report resolved.');
      }, 'btn primary'));
      if (M.can(session.account, 'pull').ok && report.version_id && !report.pulled && report.status !== 'resolved') actions.append(button('Pull release', async () => {
        const result = await call('POST', '/staff/versions/' + report.version_id + '/pull', { reason: note.value });
        if (result.status !== 200) { error.textContent = result.body.error; return; } render(); announce('Release pulled.');
      }));
      return h('article', { class: 'sidebox' }, h('h2', {}, report.name + ' ' + report.version),
        h('p', { class: 'small muted gap' }, report.reason + ' · ' + report.reporter_name + ' · ' + report.status), h('p', { class: 'gap' }, report.details),
        report.status === 'resolved' ? h('p', { class: 'small gap' }, report.resolved_by_name + ': ' + report.resolution) : h('label', { class: 'field gap' }, 'Resolution / pull reason', note), actions, error);
    })));
  }

  /** Expose role administration while keeping the API as the authorization boundary. */
  function staffPeople(body, people) {
    const name = h('input', { id: 'staff-name', required: true, maxlength: 64 });
    const role = h('select', { id: 'staff-role' }, ['player', 'moderator', 'admin'].map(value => h('option', { value }, value)));
    const reason = h('textarea', { id: 'staff-reason', required: true, maxlength: 2000 });
    const error = h('p', { class: 'error', role: 'alert' });
    body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Username'), h('th', {}, 'Role'))),
      h('tbody', {}, people.map(person => h('tr', {}, h('td', {}, person.username || 'Cinnabar player'), h('td', {}, person.role)))))),
    M.atLeast(session.account, 'admin') ? h('form', { class: 'sidebox gap', onsubmit: async event => {
      event.preventDefault(); const result = await call('POST', '/staff/people/role', { username: name.value, role: role.value, reason: reason.value });
      if (result.status !== 200) { error.textContent = result.body.error; return; } await loadSession(); render(); announce('Staff assignment updated.');
    } }, h('h2', {}, 'Change a staff assignment'), h('label', { class: 'field gap', for: 'staff-name' }, 'Username', name),
    h('label', { class: 'field', for: 'staff-role' }, 'Role', role), h('label', { class: 'field', for: 'staff-reason' }, 'Reason', reason), error,
    h('button', { type: 'submit', class: 'btn primary' }, 'Save assignment')) : null);
  }

  /** Show named, attributable audit rows without interpreting staff notes as HTML. */
  function staffAudit(body, entries) {
    body.append(entries.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Who', 'Action', 'Target', 'Note'].map(name => h('th', {}, name)))),
      h('tbody', {}, entries.map(entry => h('tr', {}, h('td', {}, entry.actor_name), h('td', {}, entry.action), h('td', {}, entry.target), h('td', {}, entry.note))))))
      : h('p', { class: 'empty' }, 'No audit entries.'));
  }

  /** Keep refresh outcomes local to status workspaces without announcing background successes repeatedly. */
  function refreshControls() {
    return liveMode ? h('div', { class: 'refresh-controls' },
      h('p', { class: 'small muted refresh-note', role: 'status' }, 'Status refreshes every 10 seconds while this page is visible.'),
      button('Refresh status', refreshCurrent, 'btn quiet', 'status:refresh')) : null;
  }

  /** Only creator and review status workspaces poll; hidden pages and navigation cancel their timers. */
  function scheduleRefresh(token, route) {
    window.clearTimeout(refreshTimer);
    if (token !== generation || !liveMode || !session.account || document.hidden
      || !(route.view === 'mine' || (route.view === 'staff' && route.tab === 'queue'))) return;
    refreshTimer = window.setTimeout(refreshCurrent, 10000);
  }

  /** Refresh identity before release data; stale responses and expired sessions cannot retain staff controls. */
  async function refreshCurrent() {
    if (refreshing || document.hidden) return;
    if (writes || submitting) { scheduleRefresh(generation, M.parseRoute(location.hash)); return; }
    const token = generation;
    refreshing = true;
    const result = await loadSession(token);
    refreshing = false;
    if (token !== generation) return;
    if (writes || submitting) { scheduleRefresh(generation, M.parseRoute(location.hash)); return; }
    if (result.status !== 200) {
      const message = app.querySelector('.refresh-note');
      if (message) message.textContent = 'Status could not refresh. Existing details are unchanged; use Refresh status to retry.';
      scheduleRefresh(token, M.parseRoute(location.hash));
      return;
    }
    await render();
  }

  /** Render only the most recent route; late responses cannot replace a newer screen. */
  async function render() {
    window.clearTimeout(refreshTimer);
    const token = ++generation;
    const route = M.parseRoute(location.hash);
    if (route.view === 'catalogue' || route.view === 'library') filters = D.read(location.hash);
    chrome(route);
    document.title = 'Marketplace · Cinnabar';
    try {
      if (route.view === 'catalogue' || route.view === 'library') await catalogue(token, route.view === 'library');
      else if (route.view === 'mod') await project(token, route);
      else if (route.view === 'submit') await editor(token);
      else if (route.view === 'mine') await mine(token, route);
      else await staff(token, route);
    } catch (_) { mount(token, failure('The response could not be displayed. Please retry.')); }
    if (token === generation) promptUsername();
    scheduleRefresh(token, route);
  }

  document.querySelector('[data-close]').addEventListener('click', () => document.getElementById('signin-dialog').close());
  document.getElementById('xbox-close').addEventListener('click', closeXbox);
  document.getElementById('username-close').addEventListener('click', closeUsername);
  document.getElementById('username-form').addEventListener('submit', saveUsername);
  usernameInput.addEventListener('input', () => { usernameStatus.textContent = ''; usernameInput.removeAttribute('aria-invalid'); });
  usernameDialog.addEventListener('cancel', event => { event.preventDefault(); closeUsername(); });
  usernameDialog.addEventListener('close', () => { if (!usernameDialog.open) { usernameEpoch++; usernameBusy = false; } });
  xboxDialog.addEventListener('close', stopXbox);
  xboxDialog.addEventListener('cancel', event => { event.preventDefault(); closeXbox(); });
  window.addEventListener('hashchange', () => {
    render(); window.scrollTo(0, 0);
    if (M.parseRoute(location.hash).view === 'submit' && session.account) requireUsername();
  });
  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(refreshTimer);
    window.clearTimeout(xboxPollTimer); window.clearTimeout(xboxClockTimer);
    xboxPollGeneration++; xboxPolling = false;
    if (!document.hidden) {
      scheduleRefresh(generation, M.parseRoute(location.hash));
      updateXboxClock(); scheduleXboxPoll();
    }
  });
  window.addEventListener('pagehide', () => { window.clearTimeout(refreshTimer); uploadController?.abort(); closeUsername(); closeXbox(); });
  document.getElementById('preview-note').hidden = !previewMode;
  document.getElementById('reset-preview').addEventListener('click', async () => {
    backend.reset(); discardDraft(); await loadSession(); await render(); announce('Sample data restored.');
  });
  const signInError = new URLSearchParams(location.search).get('signin_error');
  if (signInError) {
    const messages = { cancelled: 'Sign-in was cancelled.', child_account: 'Xbox family settings must allow this account to sign in.',
      no_xbox_profile: 'This Microsoft account does not have an Xbox profile.', xbox_unavailable: 'Xbox sign-in is unavailable. Retry shortly.' };
    announce(Object.hasOwn(messages, signInError) ? messages[signInError] : 'Sign-in could not finish. Please retry.', true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  loadSession().then(result => { if (result.status !== 200) announce(result.body.error, true); return render(); });
})();
