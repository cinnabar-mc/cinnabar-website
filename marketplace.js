(function () {
  'use strict';
  const M = window.CinnabarMarket;
  const C = window.CinnabarContent;
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
  let removingLibrary = false;
  let generation = 0;
  let query = '';
  let selectedCategory = 'all';
  let limited = false;
  let order = 'recommended';
  let draft = null;
  let draftOwner = null;
  let step = 'project';
  let fileToken = 0;
  let validationPending = false;
  let validationController = null;
  let mediaPending = false;
  let submitting = false;
  let uploadGeneration = 0;
  let refreshTimer = null;
  let refreshing = false;
  let writes = 0;
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
  const reviewNotes = new Map();
  const steps = ['project', 'media', 'release', 'checks'];
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

  /** Pick an icon from actual listing categories rather than invent an uploaded image. */
  function modIcon(mod) {
    const category = C.category(mod);
    return h('div', { class: category === 'Visuals' ? 'mod-icon warm' : 'mod-icon' },
      icon(category === 'Visuals' ? 'sun' : category === 'Camera' ? 'zoom' : category === 'Utilities' ? 'grid' : 'hud'));
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
  async function call(method, path, body) {
    if (method !== 'GET') writes++;
    try { return await backend.request(method, path, body); }
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

  /** Cancel file and image work and forget the in-memory draft. */
  function discardDraft() {
    validationController?.abort(); validationPending = false; mediaPending = false;
    fileToken++; draft = null; draftOwner = null;
  }

  /** Reflect server identity; preview account choices never appear in HTTP mode. */
  async function loadSession(expectedGeneration, current = () => true) {
    const response = await call('GET', '/me');
    if (!current() || (expectedGeneration !== undefined && expectedGeneration !== generation)) return { status: 0, stale: true, body: {} };
    if (response.status !== 200) return response;
    if (session.account?.id !== response.body.account?.id) {
      closeXbox(); discardDraft(); reviewNotes.clear();
      submitting = false; uploadGeneration++;
    }
    session = response.body;
    session.library = Array.isArray(session.library) ? session.library : [];
    return response;
  }

  /** Keep the shared site header and marketplace account/navigation consistent. */
  function chrome(route) {
    document.querySelector('.market-heading').classList.toggle('market-heading-compact', route.view === 'mod');
    const box = document.getElementById('account');
    const account = session.account;
    box.replaceChildren(account ? h('div', { class: 'account-details' },
      h('span', { class: 'who small' }, account.display_name,
        h('small', { class: 'account-email' }, account.email),
        previewMode || M.atLeast(account, 'moderator') ? h('small', {}, previewMode ? 'Preview account · ' + account.role : account.role) : null),
      h('div', { class: 'account-actions' },
        button(account.xbox ? 'Xbox linked' : 'Link Xbox', openXbox, 'btn quiet', 'account:xbox'),
        button(previewMode ? 'Switch account' : 'Sign out', previewMode ? signIn : signOut, 'btn quiet', 'account')))
      : button(previewMode ? 'Preview account' : 'Sign in with Google', signIn, 'btn quiet auth-provider', 'account'));
    const links = [['catalogue', '#/', 'Explore'], ['library', '#/library', 'My library (' + session.library.length + ')']];
    if (account) links.push(['mine', '#/mine', 'Your projects']);
    if (M.atLeast(account, 'moderator')) links.push(['staff', '#/staff/queue', 'Review']);
    links.push(['submit', '#/submit', 'Publish a mod']);
    document.getElementById('navigation').replaceChildren(...links.map(([view, href, label]) => h('a', {
      href, 'aria-current': route.view === view ? 'page' : null, class: view === 'submit' ? 'publish-link' : '',
      'data-focus-key': 'nav:' + view,
    }, label)));
  }

  /** Use Google's real redirect only through the configured HTTP adapter. */
  async function signIn() {
    if (backend.signIn) { backend.signIn(); return; }
    const response = await call('GET', '/auth/personas');
    if (response.status !== 200) { announce(response.body.error, true); return; }
    const dialog = document.getElementById('signin-dialog');
    document.getElementById('signin-body').replaceChildren(...response.body.map(persona =>
      button(h('span', {}, persona.display_name, h('small', {}, persona.blurb)), async () => {
        const signed = await call('POST', '/auth/preview', { id: persona.id });
        if (signed.status !== 200) { announce(signed.body.error, true); return; }
        discardDraft(); step = 'project';
        dialog.close(); await loadSession(); await render();
        announce('Using the ' + persona.display_name + ' preview account.');
      }, 'btn quiet')));
    dialog.showModal();
  }

  /** End the session and discard in-memory artifacts on account changes. */
  async function signOut() {
    generation++; closeXbox(); window.clearTimeout(refreshTimer);
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
    const before = JSON.stringify(session.account?.xbox);
    xboxPolling = true;
    const result = await loadSession(undefined, () => currentXbox(epoch) && !document.hidden && pollGeneration === xboxPollGeneration);
    if (pollGeneration === xboxPollGeneration) xboxPolling = false;
    if (result.stale) return;
    if (result.status === 200 && owner !== session.account?.id) { await render(); return; }
    if (!currentXbox(epoch) || document.hidden) return;
    if (result.status !== 200) document.getElementById('xbox-status').textContent = 'Could not refresh your Xbox link. Retrying…';
    else {
      chrome(M.parseRoute(location.hash));
      if (before !== JSON.stringify(session.account.xbox)) { xboxConfirm = false; renderXbox(); }
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
      chrome(M.parseRoute(location.hash)); openXbox();
      return;
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
    const rail = h('aside', { 'aria-label': 'Filter mods' });
    const grid = h('div', { class: 'catalog-grid', 'aria-label': libraryOnly ? 'Saved mods' : 'Mod results' });
    const count = h('span', { class: 'small muted', role: 'status' });
    const search = h('input', { id: 'mod-search', type: 'search', placeholder: 'Search mods', value: query,
      'aria-label': 'Search mods', 'data-focus-key': 'catalog:search', oninput: event => { query = event.target.value; results(); } });
    const sort = h('select', { 'aria-label': 'Sort mods', onchange: event => { order = event.target.value; results(); } },
      h('option', { value: 'recommended' }, 'Recommended'), h('option', { value: 'name' }, 'Name: A–Z'));
    sort.value = order;
    const categoryButtons = ['all', ...C.CATEGORIES].map(category =>
      [category, button(category === 'all' ? 'All mods' : category, () => { selectedCategory = category; results(); }, '', 'category:' + category)]);
    rail.append(h('div', { class: 'filter-section' }, h('p', { class: 'filter-title' }, 'Categories'),
      h('div', { class: 'filters' }, categoryButtons.map(([, control]) => control))),
    h('div', { class: 'filter-section' },
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: limited, onchange: event => { limited = event.target.checked; results(); } }), 'No gameplay changes')));

    /** Update just the results, keeping search, filter focus and selection intact. */
    function results() {
      let visible = M.filterMods(mods, query).filter(mod => (!libraryOnly || saved.has(mod.slug)) &&
        (selectedCategory === 'all' || C.category(mod) === selectedCategory) &&
        (!limited || !mod.capabilities.some(name => M.capability(name)?.sensitive)));
      if (order === 'name') visible = visible.slice().sort((a, b) => a.name.localeCompare(b.name));
      categoryButtons.forEach(([category, control]) => { control.className = category === selectedCategory ? 'active' : ''; control.setAttribute('aria-pressed', String(category === selectedCategory)); });
      grid.replaceChildren(...visible.map(mod => h('article', { class: 'mod-card' },
        h('div', { class: 'mod-result' }, modIcon(mod),
          h('div', { class: 'mod-card-title' }, h('h3', {}, h('a', { href: '#/mod/' + mod.slug, 'data-focus-key': 'mod:' + mod.slug }, mod.name)),
            h('span', { class: 'small muted' }, 'by ' + mod.creator_name)),
          h('p', { class: 'mod-card-summary' }, mod.summary),
          h('span', { class: 'mod-category' }, C.category(mod)),
          h('span', { class: 'release-version', 'aria-label': 'Version ' + mod.version }, mod.version)),
        libraryOnly ? removalControl(session.library.find(item => item.slug === mod.slug), 'btn quiet library-remove') : null)));
      if (libraryOnly) {
        for (const selection of session.library.filter(item => item.pulled || !mods.some(mod => mod.slug === item.slug))) {
          grid.append(h('article', { class: 'mod-card' }, h('h3', {}, selection.slug),
            h('p', {}, 'This release is unavailable. It may have been hidden or revoked.'),
            removalControl(selection)));
        }
      }
      const total = grid.querySelectorAll('.mod-card').length;
      count.textContent = total + ' mod' + (total === 1 ? '' : 's');
      if (!grid.childNodes.length) grid.append(h('div', { class: 'empty' }, h('h2', {}, libraryOnly ? 'Your library is empty.' : 'No mods match.'),
        h('p', {}, libraryOnly ? 'Explore the catalogue and inspect a mod before adding it.' : 'Try another search or category.'),
        button('Clear filters', () => { query = ''; selectedCategory = 'all'; limited = false; search.value = ''; render(); }, 'btn quiet', 'catalog:recovery')));
    }
    const content = h('div', { class: 'catalog-results' }, h('div', { class: 'search-tools' }, h('label', { class: 'search-wrap' }, icon('search'), search), sort),
      h('div', { class: 'catalog-count' }, libraryOnly ? h('h2', {}, 'Your library') : null, count),
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
    mount(token, h('section', {}, h('a', { class: 'back', href: '#/' }, 'Back to mods'),
      h('div', { class: 'project-heading' }, modIcon(mod), h('div', {}, h('h1', {}, mod.name), h('p', {}, mod.summary),
        h('div', { class: 'tags' }, h('span', { class: 'small muted' }, 'by ' + mod.creator_name), h('span', { class: 'tag' }, C.category(mod)),
          h('span', { class: 'tag' }, 'Free')))), tabs, h('div', { class: 'detail-layout' }, content, sidebar)));
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
    const initial = { name: '', slug: '', summary: '', description: '', category: 'Interface', license: '', version: '', source: '', notes: '', gallery: [] };
    draft = Object.assign(initial, saved && typeof saved === 'object' ? Object.fromEntries(Object.keys(initial).map(key => [key, saved[key] ?? initial[key]])) : {});
    draft.gallery = Array.isArray(draft.gallery) ? draft.gallery.filter(item => item && C.imageUrl(item.url)).slice(0, 12) : [];
    draft.file = null; draft.parsed = null; draft.check = null;
  }

  /** Save this account's editable draft; quota failure leaves the current form intact. */
  function saveDraft() {
    const data = { ...draft }; delete data.file; delete data.parsed; delete data.check;
    try { storage.setItem(draftKey(draftOwner), JSON.stringify(data)); announce('Draft saved in this browser. Reselect the release file after reloading.'); }
    catch (_) { announce('Browser storage is unavailable or full. Your current draft remains open; enable storage or remove images before retrying.', true); }
  }

  /** Keep image decoders and storage bounded; persist only re-encoded raster derivatives. */
  async function readImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose PNG, JPEG or WebP images up to 8 MiB each.');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 24000000) throw new Error('Images must have at most 24 megapixels.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/webp', 0.8);
      if (url.length > 360000) throw new Error('This preview image is too large. Resize or simplify it and retry.');
      return { url, caption: file.name.replace(/\.[^.]+$/, '').slice(0, 140), alt: '' };
    } finally { bitmap.close(); }
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
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const check = await window.CinnabarValidation.validate(bytes.slice(0), { signal });
      if (token !== fileToken || owner !== draftOwner) return;
      draft.file = file; draft.parsed = { ...parsed, sha256: digest, bytes: file.size }; draft.check = check;
      for (const key of ['name', 'version', 'description']) if (!draft[key]) draft[key] = parsed[key] || '';
      if (!draft.summary) draft.summary = parsed.description.slice(0, 140);
      announce('Component syntax checks passed. This is not a malware scan.');
    } catch (error) {
      if (token === fileToken && owner === draftOwner) announce(error.message || String(error), true);
    } finally {
      if (token === fileToken && owner === draftOwner) { validationPending = false; render(); }
    }
  }

  const fieldLimits = { description: 40000, notes: 4000, license: 128, summary: 140, name: 64 };

  /** Build the creator's four-step editor, keeping every local field across step changes. */
  async function editor(token) {
    if (!session.account) return mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Give your mod a home.'),
      h('p', {}, 'Sign in to prepare a project and submit a release.'), button(previewMode ? 'Choose a preview account' : 'Sign in with Google', signIn, 'btn primary', 'editor:signin')));
    if (submitting) return mount(token, h('section', { class: 'empty', role: 'status' }, h('h2', {}, 'Uploading your release…'), h('p', {}, 'Keep this tab open. Your draft will stay available if the upload fails.')));
    loadDraft();
    const form = h('form', { class: 'editor', novalidate: true });
    const panel = h('div');
    const previewName = h('h3', {}, draft.name || 'Your mod');
    const previewSummary = h('p', {}, draft.summary || 'Your summary appears here.');
    const preview = h('aside', { class: 'editor-aside' }, h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Listing preview'),
      h('div', { class: 'preview-card' }, modIcon({ capabilities: [], category: draft.category }), previewName,
        h('span', { class: 'small muted' }, session.account.display_name), previewSummary, h('span', { class: 'tag' }, 'Free')),
      h('p', { class: 'rule small muted' }, 'Drafts are private to this account in this browser. Nothing is published until the service approves a release.'));
    const stepButtons = steps.map((name, index) => h('li', {}, button(h('span', { class: 'row' }, h('span', { class: 'num' }, index + 1),
      ['Project', 'Images', 'Release', 'Checks & publish'][index]), () => { step = name; render(); }, step === name ? 'active' : '', 'step:' + name)));
    /** Bind a labelled input to the draft without replacing focused controls. */
    function field(key, label, type = 'text', hint = '') {
      const input = h(type === 'textarea' ? 'textarea' : 'input', { id: 'draft-' + key, name: key, type: type === 'textarea' ? null : type,
        value: draft[key], maxlength: fieldLimits[key] || 2000,
        oninput: event => { draft[key] = event.target.value; if (key === 'name') previewName.textContent = draft.name; if (key === 'summary') previewSummary.textContent = draft.summary; } });
      return h('label', { class: 'field', for: 'draft-' + key }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
    }
    if (step === 'project') {
      panel.append(h('h2', {}, 'Tell players what it does.'), field('name', 'Project name'), field('slug', 'Project address', 'text', '3–40 lowercase letters, numbers and dashes.'),
        field('summary', 'Summary', 'text', 'One clear sentence shown in search results.'), field('description', 'Description', 'textarea', 'Markdown headings, lists, bold text, code and HTTPS links are supported. HTML stays plain text.'),
        button('Preview description', () => descriptionPreview.replaceChildren(C.markdown(document, draft.description)), 'btn quiet', 'draft:preview'));
      const descriptionPreview = h('div'); panel.append(descriptionPreview);
      const select = h('select', { id: 'draft-category', onchange: event => { draft.category = event.target.value; } }, C.CATEGORIES.map(name => h('option', { value: name }, name)));
      select.value = draft.category;
      panel.append(h('div', { class: 'two gap' }, h('label', { class: 'field', for: 'draft-category' }, 'Category', select), field('license', 'License', 'text', 'For example MIT or All rights reserved.')),
        field('source', 'Source repository', 'url', 'A GitHub repository is required for gameplay and packet permissions.'));
    } else if (step === 'media') {
      panel.append(h('h2', {}, 'Show it in action.'), h('p', { class: 'small muted', style: 'margin-bottom:20px' }, 'Upload screenshots with captions and alt text. Preview images are resized and stripped of metadata.'));
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, 'aria-label': 'Choose project images', disabled: mediaPending,
        onchange: async event => {
          const owner = draftOwner;
          const current = draft;
          const files = Array.from(event.target.files || []);
          mediaPending = true;
          input.disabled = true;
          try {
            const max = liveMode ? 4 : 12;
            if (current.gallery.length + files.length > max) throw new Error('A release can have at most ' + max + ' images.');
            const images = [];
            for (const file of files) images.push(await readImage(file));
            if (owner !== draftOwner || current !== draft) return;
            if (JSON.stringify(current.gallery.concat(images)).length > 2000000) throw new Error('The preview gallery is limited to 2 MiB. Remove an image and retry.');
            current.gallery.push(...images); announce('Images added to your draft in this browser.');
          } catch (error) { if (owner === draftOwner) announce(error.message, true); }
          finally { if (owner === draftOwner && current === draft) { mediaPending = false; render(); } }
        } });
      panel.append(h('div', { class: 'upload-zone' }, icon('upload'), h('b', {}, mediaPending ? 'Preparing images…' : 'Choose project images'),
        h('span', { class: 'small muted' }, 'PNG, JPEG or WebP · up to 8 MiB and 24 megapixels each'), input),
        h('p', { class: 'hint' }, liveMode ? 'Up to four prepared images are uploaded as files. Captions and alt text are saved with this release.' : 'Up to twelve images in the local preview.'));
      const media = h('div', { class: 'media-strip' }, draft.gallery.map((image, index) => {
        const caption = h('input', { value: image.caption, maxlength: 140, 'aria-label': 'Caption for image ' + (index + 1), oninput: event => { image.caption = event.target.value; } });
        const alt = h('input', { value: image.alt, maxlength: 300, 'aria-label': 'Alt text for image ' + (index + 1), oninput: event => { image.alt = event.target.value; } });
        return h('div', { class: 'media-item' }, h('div', { class: 'media-tile' }, h('img', { src: C.imageUrl(image.url), alt: image.alt || 'Draft image ' + (index + 1) }),
          button('Remove', () => { draft.gallery.splice(index, 1); render(); }, 'quiet', 'image:remove:' + index)),
        h('label', { class: 'field' }, 'Caption', caption), h('label', { class: 'field' }, 'Alt text', alt));
      })); panel.append(media);
    } else if (step === 'release') {
      panel.append(h('h2', {}, 'Add a release.'), h('div', { class: 'upload-zone' }, icon('upload'), h('b', {}, validationPending ? 'Checking component…' : 'Choose your Wasm component'),
        h('span', { class: 'small muted' }, 'Portable .wasm component · up to 16 MiB'), h('input', { type: 'file', accept: '.wasm', 'aria-label': 'Choose mod component',
          onchange: event => { const file = event.target.files?.[0]; if (file) takeFile(file); } })),
      draft.file ? h('p', { class: 'small good gap' }, draft.file.name + ' · syntax checked') : h('p', { class: 'small muted gap' }, 'Select a file for this session. No uploaded code is executed.'),
      field('version', 'Version', 'text', 'Use SemVer, for example 1.2.0.'), field('notes', 'Release notes', 'textarea'));
      if (draft.parsed) panel.append(permissions({ capabilities: M.requestedCapabilities(draft.parsed.grants) }, draft.parsed.grants));
    } else {
      const checked = Boolean(draft.file && draft.parsed && draft.check);
      panel.append(h('h2', {}, 'Ready when the checks are.'), h('p', { class: 'small muted' }, 'Established creators can publish automatically only when the service confirms eligibility and completes the required checks.'),
        h('div', { class: 'scan-status' }, h('div', {}, h('span', {}, 'Browser component syntax'), h('span', { class: checked ? 'good' : 'warning' }, checked ? 'Passed' : validationPending ? 'Checking…' : 'Choose a release file')),
          h('div', {}, h('span', {}, 'Server validation & AI triage'), h('span', { class: 'muted' }, liveMode ? 'Queued after upload' : 'Not connected')),
          h('div', {}, h('span', {}, 'Automatic publication'), h('span', { class: 'muted' }, liveMode ? 'Evaluated after server checks' : 'Unavailable')),
          h('div', {}, h('span', {}, 'Publication route'), h('span', {}, liveMode ? 'Checks → publication or review' : 'Submit for review'))),
        h('div', { class: 'notice gap' }, previewMode ? 'Preview submissions stay in this browser. Staff decisions simulate publication; they do not distribute code.' : 'The service must independently validate and review the artifact. A browser check cannot authorize publication.'),
        h('label', { class: 'row gap small' }, h('input', { type: 'checkbox', id: 'distribution-rights' }), 'I have permission to distribute this code and these images.'));
    }
    const submitLabel = liveMode ? 'Upload release' : 'Submit for review';
    form.append(panel, h('div', { class: 'editor-actions' }, button('Save draft', saveDraft, 'btn quiet', 'draft:save'),
      h('button', { type: 'submit', class: 'btn primary', 'data-focus-key': 'draft:continue', disabled: validationPending || mediaPending || submitting },
        submitting ? 'Uploading…' : step === 'checks' ? submitLabel : ['Continue to images', 'Continue to release', 'Review checks'][steps.indexOf(step)])));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (validationPending || mediaPending || submitting) return announce('Wait for the current upload or file check to finish.', true);
      if (step !== 'checks') { step = steps[steps.indexOf(step) + 1]; render(); return; }
      if (!draft.file || !draft.parsed || !draft.check) { step = 'release'; await render(); return announce('Choose a valid component file first.', true); }
      if (!document.getElementById('distribution-rights').checked) return announce('Confirm your distribution rights before submitting.', true);
      const fields = { name: draft.name.trim(), slug: draft.slug.trim(), summary: draft.summary.trim(), description: draft.description,
        version: draft.version.trim(), source: draft.source.trim(), category: draft.category, license: draft.license, notes: draft.notes,
        reach: M.reachOf(draft.parsed.grants) };
      const errors = M.validateListing(fields);
      if (Object.keys(errors).length) { step = 'project'; await render(); announce(Object.values(errors).join(' '), true); return; }
      const submit = form.querySelector('[type=submit]'); submit.disabled = true;
      submitting = true; submit.textContent = 'Uploading…';
      const upload = ++uploadGeneration;
      const controls = [...form.querySelectorAll('input, textarea, select, button')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      const owner = draftOwner;
      let result;
      try {
        result = backend.submit ? await backend.submit(fields, draft.file, draft.gallery) : await call('POST', '/submissions', {
          ...fields, gallery: draft.gallery, grants: draft.parsed.grants || {}, sha256: draft.parsed.sha256, bytes: draft.file.size,
        });
      } catch (_) { result = { status: 0, body: { error: 'Upload failed. Your draft is still here; retry when connected.' } }; }
      if (upload !== uploadGeneration || owner !== draftOwner) return;
      submitting = false;
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      submit.disabled = false; submit.textContent = submitLabel;
      if (result.status !== 200) {
        if (M.parseRoute(location.hash).view === 'submit') await render();
        return announce(result.body.error, true);
      }
      announce(previewMode ? 'Preview release submitted for review. No file was distributed.' : 'Release uploaded. Follow its checks and publication status in Your projects.');
      storage.removeItem(draftKey(owner));
      draft = null; step = 'project'; location.hash = '#/mine';
    });
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('div', {}, h('h1', {}, 'Give your mod a home.'), h('p', { class: 'muted' }, 'Publishing as ' + session.account.display_name))),
      h('div', { class: 'editor-layout' }, h('aside', {}, h('ol', { class: 'steps' }, stepButtons)), form, preview)));
  }

  /** Display immutable submitted releases and any staff note without fabricating scans. */
  async function mine(token, route) {
    if (!session.account) return editor(token);
    const result = await call('GET', '/me/mods');
    if (result.status !== 200) return mount(token, failure(result.body.error));
    const selected = result.body.find(version => String(version.id) === route.id) || result.body[0];
    const detail = selected ? h('section', { class: 'release-detail gap' }, h('h2', {}, selected.name + ' ' + selected.version),
      scanEvidence(selected), selected.note ? h('p', { class: 'notice gap' }, 'Staff note: ' + selected.note) : null,
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
        h('dt', {}, 'Approvals'), h('dd', {}, version.approvals.map(person => person.display_name || person.id).join(', ') || 'None'),
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
    }, h('strong', {}, entry.name + ' ' + entry.version), h('span', { class: 'tag' }, M.RUNGS[entry.reach] || 'Unknown'),
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
    body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Display name'), h('th', {}, 'Role'))),
      h('tbody', {}, people.map(person => h('tr', {}, h('td', {}, person.display_name), h('td', {}, person.role)))))),
    M.atLeast(session.account, 'admin') ? h('form', { class: 'sidebox gap', onsubmit: async event => {
      event.preventDefault(); const result = await call('POST', '/staff/people/role', { display_name: name.value, role: role.value, reason: reason.value });
      if (result.status !== 200) { error.textContent = result.body.error; return; } await loadSession(); render(); announce('Staff assignment updated.');
    } }, h('h2', {}, 'Change a staff assignment'), h('label', { class: 'field gap', for: 'staff-name' }, 'Display name', name),
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
    chrome(route);
    document.title = 'Marketplace · Cinnabar';
    try {
      if (route.view === 'catalogue' || route.view === 'library') await catalogue(token, route.view === 'library');
      else if (route.view === 'mod') await project(token, route);
      else if (route.view === 'submit') await editor(token);
      else if (route.view === 'mine') await mine(token, route);
      else await staff(token, route);
    } catch (_) { mount(token, failure('The response could not be displayed. Please retry.')); }
    scheduleRefresh(token, route);
  }

  document.querySelector('[data-close]').addEventListener('click', () => document.getElementById('signin-dialog').close());
  document.getElementById('xbox-close').addEventListener('click', closeXbox);
  xboxDialog.addEventListener('close', stopXbox);
  xboxDialog.addEventListener('cancel', event => { event.preventDefault(); closeXbox(); });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(refreshTimer);
    window.clearTimeout(xboxPollTimer); window.clearTimeout(xboxClockTimer);
    xboxPollGeneration++; xboxPolling = false;
    if (!document.hidden) {
      scheduleRefresh(generation, M.parseRoute(location.hash));
      updateXboxClock(); scheduleXboxPoll();
    }
  });
  window.addEventListener('pagehide', () => { window.clearTimeout(refreshTimer); closeXbox(); });
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
