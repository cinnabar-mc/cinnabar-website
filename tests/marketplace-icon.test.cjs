const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const M = require('../marketplace-core.js');
const V = require('../marketplace-validation.js');
const { createHttpApi } = require('../marketplace-http.js');
const { png, chunk, component, ICON } = require('./icon-fixtures.cjs');

/** A complete icon at the byte limit; trailing bytes do not change the decoded PNG. */
function paddedIcon(length) { const bytes = Buffer.alloc(length); png().copy(bytes); return bytes; }

test('icons are optional, top-level only, unique and bounded without invalidating the component', () => {
  const valid = png();
  assert.deepEqual(M.readComponent(component([[ICON, valid]])).icon, valid);
  assert.equal(M.readComponent(component()).icon, null);
  assert.equal(M.readComponent(component([[ICON, valid], [ICON, valid]])).icon, null);
  assert.equal(M.readComponent(component([[ICON, valid], [ICON, valid], [ICON, valid]])).icon, null);
  assert.equal(M.readComponent(component([[4, component([[ICON, valid]])]])).icon, null);
  assert.equal(M.readComponent(component([[ICON, paddedIcon(262144)]])).icon.length, 262144);
  assert.equal(M.readComponent(component([[ICON, paddedIcon(262145)]])).icon, null);
});

test('PNG preflight accepts non-square dimensions up to 256 and rejects malformed PNGs', () => {
  for (const [w, h] of [[1, 1], [8, 16], [256, 256], [256, 1]]) assert.deepEqual(V.iconDimensions(png(w, h)), { width: w, height: h });
  for (const bytes of [png(257, 1), png(1, 257), png(0, 1), png(1, 0), new Uint8Array([1, 2, 3]),
    paddedIcon(262145), png().subarray(0, 40), Buffer.from('not a png')]) assert.equal(V.iconDimensions(bytes), null);
  const corrupt = png(); corrupt[corrupt.length - 1] ^= 1;
  assert.equal(V.iconDimensions(corrupt), null, 'bad CRC');
  const noPixels = Buffer.concat([png().subarray(0, 33), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(V.iconDimensions(noPixels), null);
});

test('icon extraction requires full bitmap decoding, closes decoded images and treats decoder failure as optional', async () => {
  let decodes = 0, closes = 0, reject = false;
  const context = { Uint8Array, DataView, Blob, btoa, globalThis: {}, module: { exports: {} },
    createImageBitmap: async blob => { decodes++; assert.equal(blob.type, 'image/png'); if (reject) throw new Error('bad pixels');
      return { width: 8, height: 8, close() { closes++; } }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../marketplace-validation.js'), 'utf8'), context);
  const extract = context.module.exports.iconUrl;
  assert.equal(await extract(png()), 'data:image/png;base64,' + png().toString('base64'));
  assert.equal(closes, 1);
  reject = true;
  assert.equal(await extract(png(8, 8, true)), null);
  assert.equal(await extract(null), null);
  assert.equal(await extract(png(257, 8)), null);
  assert.equal(decodes, 2, 'unbounded or missing images never reach the decoder');
});

test('API icons resolve relative to the API base and reject unsafe URLs in all release views', async () => {
  for (const [value, expected] of [['/v1/mods/icons/abc', 'https://api.test/v1/mods/icons/abc'],
    ['mods/icons/abc', 'https://api.test/v1/mods/icons/abc'], ['https://cdn.test/icon.png', 'https://cdn.test/icon.png'],
    ['javascript:alert(1)', null], ['data:image/png;base64,AQID', null], ['https://u:p@cdn.test/a', null], [null, null], ['', null]]) {
    const api = createHttpApi('https://api.test/v1', async () => ({ status: 200, json: async () => ({ id: '42', icon: value }) }), {});
    for (const path of ['/mods', '/mods/test', '/me/mods', '/staff/queue', '/staff/versions/42']) {
      assert.equal((await api.request('GET', path)).body.icon, expected, path + ' ' + value);
    }
  }
});

test('mock sample icons appear in public and version views; preview uploads drop old gallery fields', async () => {
  const { createMockApi } = require('../marketplace-mock.js');
  const api = createMockApi({ getItem: () => null, setItem() {} });
  const mods = (await api.request('GET', '/mods')).body;
  assert.equal(mods.filter(mod => mod.icon?.startsWith('data:image/png;base64,')).length, 2);
  assert.ok(mods.some(mod => mod.icon === null));
  await api.request('POST', '/auth/preview', { id: '2535400000000201' });
  assert.match((await api.request('GET', '/staff/queue')).body.find(mod => mod.slug === 'coords-hud').icon, /^data:image\/png;base64,/);
  await api.request('POST', '/auth/preview', { id: '2535400000000102' });
  const response = await api.submit({ name: 'Test upload', summary: 'A valid test upload summary.', version: '1.0.0', gallery: ['legacy'], images: ['legacy'] },
    new File([component()], 'test.wasm'));
  assert.equal(response.status, 200);
  assert.equal(response.body.icon, null); assert.equal(response.body.listing.gallery, undefined);
});

test('preview decoding cannot submit under a different account after switching identities', async () => {
  const { createMockApi } = require('../marketplace-mock.js');
  const api = createMockApi({ getItem: () => null, setItem() {} });
  await api.request('POST', '/auth/preview', { id: '2535400000000102' });
  let resume;
  const response = api.submit({ name: 'Delayed upload', summary: 'A valid test upload summary.', version: '1.0.0' },
    { size: 8, arrayBuffer: () => new Promise(resolve => { resume = resolve; }) });
  await api.request('POST', '/auth/preview', { id: '2535400000000101' });
  resume(new Uint8Array(component()).buffer);
  assert.equal((await response).status, 409);
  assert.deepEqual((await api.request('GET', '/me/mods')).body, []);
});
