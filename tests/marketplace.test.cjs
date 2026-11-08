const assert = require('node:assert/strict');
const test = require('node:test');

const M = require('../marketplace-core.js');
const { createMockApi, PERSONAS } = require('../marketplace-mock.js');

const player = { id: '1', username: 'Player', role: 'player' };
const creator = { id: '2', username: 'Creator', role: 'player' };
const mod1 = { id: '3', username: 'ModOne', role: 'moderator' };
const mod2 = { id: '4', username: 'ModTwo', role: 'moderator' };
const admin = { id: '5', username: 'Admin', role: 'admin' };
const owner = { id: '6', username: 'Owner', role: 'owner' };

test('current clock and sound permissions retain their observation and presentation review groups', () => {
  assert.equal(M.reachOf({ clock: true }), 1);
  assert.equal(M.reachOf({ audio: true }), 0);
  assert.equal(M.capability('packets').packet_only, true);
  assert.throws(() => M.reachOf({ unrecognized_permission: true }), /Unknown capability/);
});

/** A submitted version with the given grants. */
function version(grants, approvals = []) {
  return { creator: creator.id, status: 'submitted', approvals, reach: M.reachOf(grants), grants };
}

/** A mock API over in-memory storage, signed in as a sample persona. */
async function api(gamertag) {
  const store = new Map();
  const client = createMockApi({ getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    () => Date.UTC(2026, 9, 23, 12));
  if (gamertag) {
    const persona = PERSONAS.find(p => p.gamertag === gamertag);
    assert.equal((await client.request('POST', '/auth/preview', { id: persona.id })).status, 200);
  }
  client.as = async tag => {
    const persona = PERSONAS.find(p => p.gamertag === tag);
    await client.request('POST', '/auth/preview', { id: persona.id });
  };
  return client;
}

/** Builds a component binary with the given top-level custom sections. */
function component(sections, layer = [0x0d, 0, 1, 0]) {
  const bytes = [0, 0x61, 0x73, 0x6d, ...layer];
  for (const [name, data] of sections) {
    const n = Buffer.from(name);
    const body = [n.length, ...n, ...data];
    bytes.push(0, body.length, ...body);
  }
  return new Uint8Array(bytes);
}

test('files every client grant on exactly one rung', () => {
  const pinned = require('../dist/marketplace-capabilities.js');
  assert.ok(pinned.length > 0);
  assert.equal(M.CAPABILITIES.length, pinned.length);
  assert.equal(new Set(M.CAPABILITIES.map(c => c.name)).size, pinned.length);
  for (const cap of M.CAPABILITIES) assert.ok(cap.rung >= 0 && cap.rung < M.RUNGS.length, cap.name);
  // Every capability the client marks sensitive sits on Acts or Network.
  for (const cap of M.CAPABILITIES.filter(c => c.sensitive)) assert.ok(cap.rung >= 3, cap.name);
});

test('a mod reaches as far as its furthest request', () => {
  assert.equal(M.reachOf(undefined), 0);
  assert.equal(M.reachOf({ environment: true }), 0);
  assert.equal(M.reachOf({ hud: true, player_state: true }), 1);
  assert.equal(M.reachOf({ hud: true, render_through_walls: true }), 2);
  assert.equal(M.reachOf({ commands: [] }), 0);
  assert.equal(M.reachOf({ commands: ['tp'] }), 3);
  assert.equal(M.reachOf({ packets: true, hud: false }), 4);
  assert.throws(() => M.reachOf({ teleport: true }), /Unknown capability/);
  assert.throws(() => M.reachOf({ hud: 'yes' }), /true or false/);
  assert.deepEqual(M.grantDiff({ packets: true, wasi: true }, { packets: true, packet_delay: true }),
    { added: ['packet_delay'], removed: ['wasi'], kept: ['packets'], changed: [], commands: { added: [], removed: [] }, expanded: true });
});

test('reach decides how many staff approve and whether one is an admin', () => {
  const looks = version({ hud: true });
  assert.ok(M.can(mod1, 'approve', { version: looks }).ok);
  assert.equal(M.decide(looks, mod1, 'approve', '', 1).status, 'approved');

  const acts = version({ camera: true });
  assert.match(M.can(mod1, 'approve', { version: acts }).reason, /admin/);
  assert.equal(M.decide(acts, admin, 'approve', '', 1).status, 'approved');

  const network = version({ packets: true });
  const first = M.decide(network, mod1, 'approve', '', 1);
  assert.equal(first.status, 'submitted');
  assert.match(M.can(mod2, 'approve', { version: first }).reason, /admin/);
  assert.match(M.can(mod1, 'approve', { version: first }).reason, /already approved/);
  assert.equal(M.decide(first, admin, 'approve', '', 2).status, 'approved');
  const adminFirst = M.decide(network, admin, 'approve', '', 1);
  assert.equal(adminFirst.status, 'submitted');
  assert.equal(M.decide(adminFirst, mod1, 'approve', '', 2).status, 'approved');
});

test('staff cannot review their own mods, and rejections explain themselves', () => {
  const own = Object.assign(version({ hud: true }), { creator: admin.id });
  assert.match(M.can(admin, 'approve', { version: own }).reason, /your own/);
  assert.equal(M.can(player, 'review', { version: version({}) }).ok, false);
  assert.equal(M.can(null, 'send').ok, false);
  assert.throws(() => M.decide(version({ hud: true }), mod1, 'reject', ' ', 1), /why/);
  assert.equal(M.decide(version({ hud: true }), mod1, 'changes', 'Fix Escape', 1).status, 'changes');
  const approved = Object.assign(version({}), { status: 'approved' });
  assert.equal(M.can(mod1, 'approve', { version: approved }).ok, false);
});

test('only admins add moderators and only owners add admins', () => {
  assert.equal(M.can(mod1, 'set-role', { target: player, role: 'moderator' }).ok, false);
  assert.ok(M.can(admin, 'set-role', { target: player, role: 'moderator' }).ok);
  assert.ok(M.can(admin, 'set-role', { target: mod1, role: 'player' }).ok);
  assert.equal(M.can(admin, 'set-role', { target: player, role: 'admin' }).ok, false);
  assert.equal(M.can(admin, 'set-role', { target: { ...admin, id: '9' }, role: 'player' }).ok, false);
  assert.ok(M.can(owner, 'set-role', { target: mod1, role: 'admin' }).ok);
  assert.equal(M.can(owner, 'set-role', { target: player, role: 'owner' }).ok, false);
  assert.equal(M.can(owner, 'set-role', { target: owner, role: 'player' }).ok, false);
  assert.equal(M.can(admin, 'pull').ok, true);
  assert.equal(M.can(mod1, 'pull').ok, false);
});

test('source is optional at every reach and a supplied link must be a GitHub repository', () => {
  const base = { slug: 'zoom', name: 'Zoom', summary: 'Zooms the camera in.', version: '1.0.0' };
  for (let reach = 0; reach <= 4; reach++) {
    assert.deepEqual(M.validateListing({ ...base, reach }), {});
    assert.deepEqual(M.validateListing({ ...base, reach, source: 'https://github.com/a/zoom' }), {});
    assert.ok(M.validateListing({ ...base, reach, source: 'https://example.com/a/zoom' }).source);
  }
  const bad = M.validateListing({ slug: 'Zoom!', name: '', summary: 'short', version: 'v1', source: 'http://x', reach: 0 });
  assert.deepEqual(Object.keys(bad).sort(), ['name', 'slug', 'source', 'summary', 'version']);
});

test('optional addresses derive bounded ASCII slugs while custom addresses are lowercased and reserved names rejected', () => {
  const base = { summary: 'A valid project summary.', version: '1.0.0', category: '' };
  for (const [name, slug] of [['Steroids for Cinnabar', 'steroids-for-cinnabar'], ['None', 'none'],
    ['  Hello, 👋 WORLD!! ', 'hello-world'], ['a'.repeat(39) + ' !! b', 'a'.repeat(39)], ['A'.repeat(64), 'a'.repeat(40)]]) {
    assert.equal(M.listingSlug({ name }), slug);
    assert.deepEqual(M.validateListing({ ...base, name, slug: '' }), {});
  }
  assert.equal(M.listingSlug({ name: 'Other', slug: 'None' }), 'none');
  for (const name of ['ab', '😀🎮', '---']) {
    assert.match(M.validateListing({ ...base, name }).slug, /Pick a project address/);
    assert.deepEqual(M.validateListing({ ...base, name, slug: 'custom-address' }), {});
  }
  for (const slug of ['revocations', 'assets', 'media', 'cinnabar-mod']) {
    assert.match(M.validateListing({ ...base, name: 'Valid project', slug }).slug, /reserved/);
    assert.match(M.validateListing({ ...base, name: slug }).slug, /reserved/);
  }
  assert.equal(M.normalizeAddress('None'), 'none');
  assert.equal(M.normalizeAddress('My Project  Address'), 'my-project-address');
  assert.ok(M.validateListing({ ...base, name: 'Valid', license: 'a'.repeat(129) }).license);
  assert.ok(M.validateListing({ ...base, name: 'Valid', notes: 'a'.repeat(4001) }).notes);
  assert.ok(M.validateListing({ ...base, name: 'Valid', category: 'Other' }).category);
  assert.ok(M.validateListing({ ...base, name: 'Valid', version: '1.0.0-' + 'a'.repeat(27) }).version);
});

test('mock submissions derive blank addresses and accept missing source at every reach', async () => {
  const client = await api('BlockSmith42');
  const grants = [{ hud: true }, { player_state: true }, { render_through_walls: true }, { camera: true }, { packets: true }];
  for (const [reach, request] of grants.entries()) {
    const result = await client.request('POST', '/submissions', { name: 'Steroids for Cinnabar ' + reach, slug: '',
      summary: 'A valid project summary.', version: '1.0.0', grants: request, sha256: 'a'.repeat(64), bytes: 8 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.slug, 'steroids-for-cinnabar-' + reach);
    assert.equal(result.body.reach, reach);
    assert.equal(result.body.source, '');
  }
  const base = { name: 'Another project', summary: 'A valid project summary.', version: '1.0.0', grants: {}, sha256: 'a'.repeat(64), bytes: 8 };
  assert.equal((await client.request('POST', '/submissions', { ...base, slug: 'None' })).body.slug, 'none');
  for (const name of ['ab', '🎮']) {
    const result = await client.request('POST', '/submissions', { ...base, name });
    assert.equal(result.status, 422); assert.match(result.body.fields.slug, /Pick a project address/);
  }
  assert.equal((await client.request('POST', '/submissions', { ...base, slug: 'media' })).status, 422);
});

test('routes come from the hash so static hosting serves every view', () => {
  assert.deepEqual(M.parseRoute(''), { view: 'catalogue' });
  assert.deepEqual(M.parseRoute('#/?reach=2'), { view: 'catalogue' });
  assert.deepEqual(M.parseRoute('#/mod/time-changer'), { view: 'mod', slug: 'time-changer' });
  assert.deepEqual(M.parseRoute('#/staff'), { view: 'staff', tab: 'queue', id: undefined });
  assert.deepEqual(M.parseRoute('#/staff/queue/v4'), { view: 'staff', tab: 'queue', id: 'v4' });
  assert.deepEqual(M.parseRoute('#/staff/people'), { view: 'staff', tab: 'people', id: undefined });
  assert.deepEqual(M.parseRoute('#/nope'), { view: 'catalogue' });
});

test('reads metadata and grant requests from a component without running it', () => {
  const name = [0, 6, 5, ...Buffer.from('Zoomy')];
  const parsed = M.readComponent(component([
    ['component-name', name],
    ['version', Buffer.from('1.4.0')],
    ['description', Buffer.from('Zooms.')],
    ['cinnabar:grants', Buffer.from('{"camera":true,"hud":false}')],
  ]));
  assert.equal(parsed.name, 'Zoomy');
  assert.equal(parsed.version, '1.4.0');
  assert.deepEqual(parsed.grants, { camera: true, hud: false });
  assert.equal(M.reachOf(parsed.grants), 3);
  assert.equal(M.readComponent(component([])).grantsDeclared, false);
  assert.throws(() => M.readComponent(component([], [1, 0, 0, 0])), /core module/);
  assert.throws(() => M.readComponent(new Uint8Array([1, 2, 3])), /WebAssembly/);
  assert.throws(() => M.readComponent(component([['cinnabar:grants', Buffer.from('{"fly":true}')]])), /Unknown capability/);
  assert.throws(() => M.readComponent(component([['version', Buffer.from('1')]]).slice(0, 12)), /Truncated/);
});

test('a submission stays private until staff approve it, then anyone can send it', async () => {
  const client = await api();
  assert.equal((await client.request('POST', '/mods/time-changer/send')).status, 401);
  await client.as('BlockSmith42');
  const sha256 = 'a'.repeat(64);
  const listing = { slug: 'compass', name: 'Compass', summary: 'A compass strip at the top.', version: '0.1.0',
    grants: { hud: true, player_state: true }, sha256, bytes: 1200 };
  const submitted = await client.request('POST', '/submissions', listing);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.status, 'submitted');
  assert.equal((await client.request('GET', '/mods/compass')).status, 404);
  assert.equal((await client.request('GET', '/staff/queue')).status, 403);
  assert.equal((await client.request('POST', '/submissions', listing)).status, 409);

  await client.as('PixelWarden');
  const queue = (await client.request('GET', '/staff/queue')).body;
  const entry = queue.find(v => v.slug === 'compass');
  assert.equal(entry.reach, 1);
  const decided = await client.request('POST', `/staff/versions/${entry.id}/decision`, { decision: 'approve' });
  assert.equal(decided.body.status, 'approved');

  await client.as('MossyCobble');
  const live = await client.request('GET', '/mods/compass');
  assert.equal(live.body.reviewed_by, 'PixelWarden');
  assert.deepEqual(live.body.capabilities, ['hud', 'player_state']);
  assert.equal((await client.request('POST', '/mods/compass/send')).status, 200);
  assert.deepEqual((await client.request('GET', '/me')).body.library.map(e => e.slug), ['compass']);
  const audit = await client.request('GET', '/staff/audit');
  assert.equal(audit.status, 403);
});

test('another creator cannot take over a listing name', async () => {
  const client = await api('MossyCobble');
  const result = await client.request('POST', '/submissions', { slug: 'time-changer', name: 'Mine', summary: 'Not the real one at all.',
    version: '9.0.0', grants: {}, sha256: 'b'.repeat(64), bytes: 10 });
  assert.equal(result.status, 409);
  assert.ok(result.body.fields.slug);
});

test('the server enforces review rules even when the page would allow a click', async () => {
  const client = await api('PixelWarden');
  const queue = (await client.request('GET', '/staff/queue')).body;
  const chat = queue.find(v => v.slug === 'chat-tweaks');
  const denied = await client.request('POST', `/staff/versions/${chat.id}/decision`, { decision: 'approve' });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /admin/);
  const party = queue.find(v => v.slug === 'party-sync');
  assert.deepEqual(party.previous.diff.added, ['packet_delay']);
  await client.as('RedstoneRook');
  assert.equal((await client.request('POST', `/staff/versions/${party.id}/decision`, { decision: 'approve' })).body.status, 'approved');
  assert.equal((await client.request('GET', '/mods/party-sync')).body.version, '0.4.0');
});

test('pulling a version removes it from the catalogue and the audit log records who and why', async () => {
  const client = await api('PixelWarden');
  const keystrokes = (await client.request('GET', '/mods/keystrokes')).body;
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: 'Broken' })).status, 403);
  await client.as('RedstoneRook');
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: '' })).status, 400);
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: 'Covers the hotbar' })).status, 200);
  assert.equal((await client.request('GET', '/mods/keystrokes')).status, 404);
  const audit = (await client.request('GET', '/staff/audit')).body;
  assert.deepEqual([audit[0].actor_name, audit[0].action, audit[0].target, audit[0].note],
    ['RedstoneRook', 'pulled', 'keystrokes 1.1.0', 'Covers the hotbar']);
  await client.request('POST', '/staff/mods/clear-skies/hide', { hidden: true, reason: 'Checking a report' });
  assert.equal((await client.request('GET', '/mods')).body.some(m => m.slug === 'clear-skies'), false);
});

test('role changes follow the account and need a reason', async () => {
  const client = await api('RedstoneRook');
  assert.equal((await client.request('POST', '/staff/people/role', { username: 'MossyCobble', role: 'admin', reason: 'x' })).status, 403);
  assert.equal((await client.request('POST', '/staff/people/role', { username: 'MossyCobble', role: 'moderator', reason: '' })).status, 400);
  assert.equal((await client.request('POST', '/staff/people/role', { username: 'nobody', role: 'moderator', reason: 'x' })).status, 404);
  const promoted = await client.request('POST', '/staff/people/role', { username: 'mossycobble', role: 'moderator', reason: 'Helps in Discord' });
  assert.equal(promoted.body.role, 'moderator');
  await client.as('MossyCobble');
  assert.equal((await client.request('GET', '/staff/queue')).status, 200);
  assert.equal((await client.request('GET', '/me')).body.account.role, 'moderator');
});

test('reports need a signed-in player, a reason and details', async () => {
  const client = await api();
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'Camera sticks.' })).status, 401);
  await client.as('MossyCobble');
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'nope', details: 'Camera sticks after Alt.' })).status, 400);
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'short' })).status, 400);
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'Camera sticks after Alt.' })).status, 200);
  await client.as('PixelWarden');
  const reports = (await client.request('GET', '/staff/reports')).body;
  assert.equal(reports[0].slug, 'freelook');
  assert.equal((await client.request('POST', `/staff/reports/${reports[0].id}/resolve`, { note: '' })).status, 400);
  assert.equal((await client.request('POST', `/staff/reports/${reports[0].id}/resolve`, { note: 'Fixed in 0.9.1' })).body.status, 'resolved');
});

test('the live client sends the session cookie, repeats the CSRF token and uploads components as forms', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  const calls = [];
  const replies = [{ account: { id: 'google-steve', username: 'Steve', email: 'steve@example.test', role: 'player', suspended: false, xbox: null }, library: [], csrf: 'token-1', game_online: false }, { id: '12', status: 'submitted' }];
  const location = { href: 'https://site.test/mods/#/submit', assign: url => calls.push({ assigned: url }) };
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push({ url, init });
    return { status: 200, json: async () => replies.shift() };
  }, location);
  await client.request('GET', '/me');
  const file = new File([new Uint8Array([0, 0x61, 0x73, 0x6d])], 'compass.wasm');
  const result = await client.submit({ slug: 'compass', version: '0.1.0' }, file);
  assert.equal(result.body.status, 'submitted');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-Cinnabar-CSRF'], undefined);
  assert.equal(calls[1].url, 'https://api.test/v1/submissions');
  assert.equal(calls[1].init.headers['X-Cinnabar-CSRF'], 'token-1');
  assert.equal(calls[1].init.headers['Content-Type'], undefined);
  assert.ok(calls[1].init.body instanceof FormData);
  assert.deepEqual(JSON.parse(calls[1].init.body.get('listing')), { slug: 'compass', version: '0.1.0' });
  assert.equal(calls[1].init.body.get('file').name, 'compass.wasm');
  client.signIn();
  assert.equal(calls[2].assigned, 'https://api.test/v1/auth/google/start?return_to=' + encodeURIComponent(location.href));
});

test('the live adapter refuses oversized descriptions while retaining the draft', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  let sent = false;
  const client = createHttpApi('https://api.test/v1', async () => { sent = true; }, {});
  const result = await client.submit({ description: 'x'.repeat(40001) }, new File(['data'], 'mod.wasm'));
  assert.equal(result.status, 422);
  assert.match(result.body.error, /draft has been retained/);
  assert.equal(sent, false);
});

test('live uploads send only listing text and the component, dropping legacy images', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  const calls = [];
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push({ url, init }); return { status: 200, json: async () => ({ id: '7', gallery: [] }) };
  }, {});
  const file = new File(['component'], 'mod.wasm');
  const fields = { description: 'd'.repeat(40000), license: 'MIT', notes: 'Release notes' };
  assert.equal((await client.submit({ ...fields, gallery: ['legacy'], images: ['legacy'] }, file, ['legacy'])).status, 200);
  const form = calls[0].init.body;
  assert.deepEqual([...form.keys()], ['listing', 'file']);
  assert.deepEqual(JSON.parse(form.get('listing')), fields);
  assert.equal(await form.get('file').text(), 'component');
});

test('the HTTP adapter derives public and private media routes from digests and clears stale CSRF on signout', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  const sha256 = 'a'.repeat(64); const calls = [];
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push(init);
    return { status: 200, json: async () => url.endsWith('/me') ? { csrf: calls.length === 1 ? 'token' : null, account: null }
      : url.endsWith('/auth/signout') ? {} : [{ id: '42', gallery: [{ sha256, caption: 'Image', url: 'https://evil.test' }, { sha256: '../private' }] }] };
  }, {});
  await client.request('GET', '/me');
  const privateView = await client.request('GET', '/me/mods');
  assert.equal(privateView.body[0].gallery[0].url, 'https://api.test/v1/me/mods/42/media/' + sha256);
  assert.equal(privateView.body[0].gallery[0].private, true);
  assert.equal(privateView.body[0].gallery.length, 1);
  assert.equal((await client.request('GET', '/mods')).body[0].gallery[0].url, 'https://api.test/v1/mods/media/' + sha256);
  await client.request('POST', '/auth/signout');
  await client.request('POST', '/mods/test/send');
  assert.equal(calls[3].headers['X-Cinnabar-CSRF'], 'token');
  assert.equal(calls[4].headers['X-Cinnabar-CSRF'], '');
  assert.equal(client.fileUrl('../auth'), null);
});

test('Google sign-in preserves the entire current marketplace URL in return_to', () => {
  const { createHttpApi } = require('../marketplace-http.js');
  let assigned;
  const location = { href: 'https://site.test/marketplace/?from=library&sort=name#/mod/time-changer', assign: value => { assigned = value; } };
  createHttpApi('https://api.test/v1/', () => { throw new Error('Navigation must not fetch.'); }, location).signIn();
  const url = new URL(assigned);
  assert.equal(url.origin + url.pathname, 'https://api.test/v1/auth/google/start');
  assert.equal(url.searchParams.get('return_to'), location.href);
});

test('Xbox link-code and unlink use credentials and CSRF and accept an empty 204 response', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  const calls = [];
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/me')) return { status: 200, json: async () => ({ csrf: 'account-csrf', account: { id: 'google-1', xbox: null }, library: [] }) };
    if (url.endsWith('/link-code')) return { status: 200, json: async () => ({ code: 'CODE1234', expires_in: 600 }) };
    return { status: 204, json: () => { throw new Error('204 must not be decoded.'); } };
  }, {});
  await client.request('GET', '/me');
  assert.equal((await client.request('POST', '/me/xbox/link-code')).body.code, 'CODE1234');
  assert.deepEqual(await client.request('POST', '/me/xbox/unlink'), { status: 204, body: null });
  for (const call of calls.slice(1)) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(call.init.headers['X-Cinnabar-CSRF'], 'account-csrf');
    assert.equal(call.init.method, 'POST');
  }
  await client.request('POST', '/auth/signout');
  await client.request('POST', '/me/xbox/link-code');
  assert.equal(calls.at(-1).init.headers['X-Cinnabar-CSRF'], '');
});

test('mock usernames validate format, reserved and taken names case-insensitively, and can only be set once', async () => {
  const client = await api();
  assert.equal((await client.request('POST', '/me/username', { username: 'New_Player' })).status, 401);
  await client.as('GoogleBuilder');
  assert.equal((await client.request('GET', '/me')).body.account.username, null);
  for (const username of [null, 123, '', 'ab', 'a'.repeat(17), 'has space', 'bad-name', 'éclair', 'valid\n']) {
    const fresh = await api('GoogleBuilder');
    assert.equal((await fresh.request('POST', '/me/username', { username })).status, 400, String(username));
  }
  for (const username of ['ADMIN', 'Cinnabar', 'Support', 'MOD', 'Owner']) {
    const fresh = await api('GoogleBuilder');
    const result = await fresh.request('POST', '/me/username', { username });
    assert.equal(result.status, 400); assert.match(result.body.error, /reserved/);
  }
  assert.equal((await client.request('POST', '/me/username', { username: 'mOsSyCoBbLe' })).status, 409);
  assert.equal((await client.request('POST', '/submissions', {})).status, 409);
  const response = await client.request('POST', '/me/username', { username: 'New_Player42' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, (await client.request('GET', '/me')).body);
  assert.equal(response.body.account.username, 'New_Player42');
  assert.equal(response.body.account.xbox, null);
  assert.equal(Object.hasOwn(response.body.account, 'display_name'), false);
  assert.equal((await client.request('POST', '/me/username', { username: 'Different' })).status, 409);
  assert.equal((await client.request('GET', '/me')).body.account.username, 'New_Player42');
});

test('HTTP username writes use credentials and CSRF and accept a full session with its updated token', async () => {
  const calls = [];
  const { createHttpApi } = require('../marketplace-http.js');
  const envelope = { account: { id: 'player', username: 'New_Player' }, library: [], csrf: 'new-token', game_online: false };
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push({ url, init });
    return { status: 200, json: async () => url.endsWith('/username') ? envelope : { ...envelope, csrf: 'original-token' } };
  }, {});
  await client.request('GET', '/me');
  assert.deepEqual((await client.request('POST', '/me/username', { username: 'New_Player' })).body, envelope);
  assert.equal(calls[1].url, 'https://api.test/v1/me/username');
  assert.equal(calls[1].init.credentials, 'include');
  assert.equal(calls[1].init.headers['X-Cinnabar-CSRF'], 'original-token');
  assert.deepEqual(JSON.parse(calls[1].init.body), { username: 'New_Player' });
  await client.request('POST', '/me/xbox/link-code');
  assert.equal(calls[2].init.headers['X-Cinnabar-CSRF'], 'new-token');
});

test('mock public creator and reviewer names use usernames and neutral fallbacks without Xbox names', async () => {
  const memory = new Map();
  const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const initial = createMockApi(store); await initial.request('GET', '/me');
  const state = JSON.parse(memory.get(require('../marketplace-mock.js').STORAGE_KEY));
  state.accounts['2535400000000102'].username = 'Chosen_Creator';
  state.accounts['2535400000000201'].username = null;
  memory.set(require('../marketplace-mock.js').STORAGE_KEY, JSON.stringify(state));
  const client = createMockApi(store);
  const listing = (await client.request('GET', '/mods/time-changer')).body;
  assert.equal(listing.creator_name, 'Chosen_Creator');
  assert.equal(listing.reviewed_by, 'Cinnabar player');
  assert.deepEqual(listing.history[0].reviewers, ['Cinnabar player']);
  await client.request('POST', '/auth/preview', { id: '2535400000000201' });
  assert.equal((await client.request('POST', '/staff/versions/v1/decision', { decision: 'approve' })).status, 409);
});

test('mock username rate limits include failed attempts and expire after ten minutes', async () => {
  const memory = new Map(); let clock = Date.UTC(2026, 10, 8);
  const client = createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }, () => clock);
  await client.request('POST', '/auth/preview', { id: 'google-only' });
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await client.request('POST', '/me/username', { username: 'MossyCobble' })).status, 409);
  }
  assert.equal((await client.request('POST', '/me/username', { username: 'Valid_Player' })).status, 429);
  clock += 600000;
  assert.equal((await client.request('POST', '/me/username', { username: 'Valid_Player' })).status, 200);
  assert.equal((await client.request('POST', '/me/username', { username: 'Other_Player' })).status, 409);
});

test('mock usernames accept the three and sixteen character boundaries', async () => {
  for (const username of ['api', 'A1_'.repeat(5) + 'x']) {
    const client = await api('GoogleBuilder');
    assert.equal((await client.request('POST', '/me/username', { username })).status, 200);
  }
});
