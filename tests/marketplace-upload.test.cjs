const assert = require('node:assert/strict');
const test = require('node:test');
const U = require('../marketplace-upload.js');
const C = require('../marketplace-content.js');
const { UPLOAD_LIMITS: limits } = require('../marketplace-mock.js');
const { createHttpApi } = require('../marketplace-http.js');

test('saved screenshot descriptors never restore files, previews or arbitrary properties', () => {
  const restored = U.restoreImages([{ sha256: 'a'.repeat(64), name: 'one.png', caption: 'HUD', alt: 'HUD in game', file: {}, url: 'https://bad.test' },
    { sha256: { toString: 'bad' }, name: 'bad', caption: '', alt: '' }]);
  assert.deepEqual(restored, [{ sha256: 'a'.repeat(64), name: 'one.png', caption: 'HUD', alt: 'HUD in game', file: null, url: null }]);
  assert.equal(U.validLimits({ image_bytes: 1024 }), false);
});

test('raster headers are bounded before decode, including WebP dimensions and animation', () => {
  const png = new Uint8Array(33);
  png.set([137,80,78,71,13,10,26,10]); png.set(Buffer.from('IHDR'), 12);
  const view = new DataView(png.buffer); view.setUint32(8, 13); view.setUint32(16, 1920); view.setUint32(20, 1080);
  assert.deepEqual(U.dimensions(png, limits), { width: 1920, height: 1080, type: 'image/png' });
  view.setUint32(16, limits.image_dimension + 1);
  assert.throws(() => U.dimensions(png, limits), /pixels per side/);
  const webp = new Uint8Array(30); webp.set(Buffer.from('RIFF'), 0); webp.set(Buffer.from('WEBPVP8X'), 8);
  webp[24] = 99; webp[27] = 49;
  assert.deepEqual(U.dimensions(webp, limits), { width: 100, height: 50, type: 'image/webp' });
  webp[20] = 2; assert.throws(() => U.dimensions(webp, limits), /still image/);
  assert.throws(() => U.dimensions(new Uint8Array(30), limits), /PNG, JPEG or WebP/);
});

test('lost-response recovery requires exact owner, component, text and ordered image metadata', () => {
  const attempt = { owner: 'creator', sha256: 'a'.repeat(64), fields: { slug: 'zoom', version: '1.0.0', name: 'Zoom', summary: 'Zoom smoothly' },
    images: [{ sha256: 'b'.repeat(64), caption: 'One', alt: 'First' }, { sha256: 'c'.repeat(64), caption: 'Two', alt: 'Second' }] };
  const received = { ...attempt.fields, creator: attempt.owner, sha256: attempt.sha256, gallery: structuredClone(attempt.images), id: '12' };
  assert.equal(U.receipt([received], attempt), received);
  assert.equal(U.receipt([null, received], attempt), received);
  for (const changed of [null, { ...received, creator: 'other' }, { ...received, sha256: 'f'.repeat(64) }, { ...received, name: 'Renamed' },
    { ...received, gallery: [...received.gallery].reverse() }, { ...received, gallery: received.gallery.map(item => ({ ...item, alt: 'Changed' })) }]) {
    assert.equal(U.receipt([changed], attempt), undefined);
  }
});

test('release progress distinguishes scanning, review, held decisions and confirmed publication', () => {
  const version = { status: 'submitted', scan: { state: 'running' } };
  const states = value => C.releaseTimeline(value).map(item => item.state);
  assert.deepEqual(states({ status: 'submitted' }), ['complete', 'pending', 'pending', 'pending']);
  assert.deepEqual(states(version), ['complete', 'current', 'pending', 'pending']);
  version.scan = { state: 'complete', review_ready: true, report: { deterministic: 'pass', ai: { verdict: 'flag' } } };
  assert.deepEqual(states(version), ['complete', 'complete', 'current', 'pending']);
  assert.deepEqual(states({ ...version, publication: 'automatic' }), ['complete', 'complete', 'complete', 'current']);
  assert.deepEqual(states({ ...version, status: 'approved' }), ['complete', 'complete', 'complete', 'complete']);
  assert.deepEqual(states({ ...version, scan: { state: 'failed' } }), ['complete', 'error', 'pending', 'pending']);
  assert.equal(states({ ...version, status: 'approved', pulled: true })[3], 'error');
  assert.equal(C.releaseState({ status: 'approved', hidden: true }).label, 'Hidden');
});

/** A controllable upload transport with the browser's relevant XHR contract. */
function xhrFixture() {
  const requests = [];
  class Xhr {
    constructor() { this.upload = {}; this.headers = {}; requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort(); }
    reply(body) { this.status = 200; this.responseText = JSON.stringify(body); this.onload(); }
  }
  const api = createHttpApi('https://api.test/v1', async () => Response.json({ csrf: 'session-token', upload_limits: limits }), {}, () => new Xhr());
  return { api, requests };
}

test('live gallery upload preserves file order, captions, credentials, CSRF and real byte progress', async () => {
  const { api, requests } = xhrFixture(); await api.request('GET', '/me');
  const images = ['one', 'two'].map(name => ({ file: new File([name], name + '.png', { type: 'image/png' }), caption: name, alt: name + ' image' }));
  const progress = [];
  const pending = api.submit({ slug: 'zoom', version: '1.0.0' }, new File(['component'], 'zoom.wasm'), { images, onProgress: value => progress.push(value) });
  const request = requests[0];
  assert.equal(request.withCredentials, true); assert.equal(request.headers['X-Cinnabar-CSRF'], 'session-token');
  assert.deepEqual(request.body.getAll('images').map(image => image.name), ['one.png', 'two.png']);
  assert.deepEqual(JSON.parse(request.body.get('image_metadata')), [{ caption: 'one', alt: 'one image' }, { caption: 'two', alt: 'two image' }]);
  request.upload.onprogress({ loaded: 50, total: 100, lengthComputable: true });
  assert.deepEqual(progress, [{ loaded: 50, total: 100 }]);
  request.reply({ id: '12', gallery: [] }); assert.equal((await pending).status, 200);
});

test('upload cancellation aborts its request and an unreadable success response stays recoverable', async () => {
  const { api, requests } = xhrFixture();
  const controller = new AbortController();
  const pending = api.submit({}, new File(['component'], 'mod.wasm'), { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /stopped/); assert.equal(requests[0].aborted, true);
  const malformed = api.submit({}, new File(['component'], 'mod.wasm'));
  requests[1].status = 200; requests[1].responseText = 'truncated'; requests[1].onload();
  assert.equal((await malformed).status, 502);
});
