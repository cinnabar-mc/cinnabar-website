const assert = require('node:assert/strict');
const test = require('node:test');
const D = require('../marketplace-discovery.js');

const mods = [
  { slug: 'z', name: 'Zoom', summary: 'A camera tool', category: 'Camera', capabilities: ['camera'], updated_at: 200 },
  { slug: 'h', name: 'HUD', summary: 'A camera tool overlay', category: 'Interface', capabilities: ['hud'], updated_at: 300 },
  { slug: 'a', name: 'Alpha', summary: 'A camera tool', category: 'Visuals', capabilities: [], updated_at: null },
];

test('catalogue URLs round-trip filters, escaping text and dropping unknown options', () => {
  const state = { query: 'HUD & maps/#?', category: 'Interface', limited: true, order: 'updated' };
  const url = D.url('catalogue', state);
  assert.deepEqual(D.read(url), state);
  assert.equal(D.url('library', D.read('#/library')), '#/library');
  assert.deepEqual(D.read('#/?category=Unknown&sort=__proto__&limited=yes'), D.read('#/'));
  assert.equal(D.read('#/?q=%E0%A4%A').query.includes('\ufffd'), true);
});

test('facets count the current search and gameplay restriction independently of category', () => {
  const state = { ...D.read('#/'), query: 'camera tool', category: 'Camera', limited: true };
  const counts = D.counts(mods, state);
  assert.equal(counts.all, 2);
  assert.equal(counts.Camera, 0);
  assert.equal(counts.Interface, 1);
  assert.equal(counts.Visuals, 1);
  assert.deepEqual(D.select(mods, state), []);
});

test('recently updated uses publication dates, with undated releases last and stable ties', () => {
  const state = { ...D.read('#/'), order: 'updated' };
  assert.deepEqual(D.select(mods, state).map(mod => mod.slug), ['h', 'z', 'a']);
  assert.deepEqual(D.select([...mods].reverse(), { ...state, order: 'recommended' }).map(mod => mod.slug), ['a', 'h', 'z']);
  assert.deepEqual(D.select(mods, { ...state, order: 'name' }).map(mod => mod.slug), ['a', 'h', 'z']);
});

test('unavailable library items match text but never claim known category or gameplay permissions', () => {
  const missing = [{ slug: 'missing', name: 'Missing', capabilities: [], unavailable: true }];
  assert.equal(D.select(missing, D.read('#/?q=missing')).length, 1);
  assert.equal(D.counts(missing, D.read('#/')).all, 1);
  assert.equal(D.select(missing, D.read('#/?limited=1')).length, 0);
  assert.equal(D.select(missing, D.read('#/?category=Visuals')).length, 0);
});
