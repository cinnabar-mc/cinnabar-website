/* Cinnabar Arcade: the attract-mode world, drawn in code at a low native resolution and scaled by whole device pixels.
   Every pixel comes from one 16-colour sprite palette: cool night blues plus ember, rust, oxide and ochre ramps derived
   from the icon red. The world is seeded, so every visit and every width draws the same place. */
(() => {
  'use strict';
  const canvases = Array.from(document.querySelectorAll('canvas[data-scene]'));
  if (!canvases.length || !window.ImageData) return;
  const root = document.documentElement;
  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const TICK = 1000 / 12;
  const SEED = 0x51CB;

  /* ---------- Deterministic noise ---------- */

  /** Hashes an integer lattice point to 0..1 so terrain is identical on every visit. */
  function hash(i, seed) {
    let h = Math.imul((i | 0) ^ Math.imul(seed, 0x9E3779B1), 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  /** Hashes a 2D lattice point to 0..1. */
  const hash2 = (x, y, seed) => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663), seed);
  /** Smooth value noise along one axis. */
  function noise(x, seed) {
    const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
    return hash(i, seed) * (1 - t) + hash(i + 1, seed) * t;
  }
  /** Layered value noise for ridgelines. */
  function fbm(x, seed, octaves) {
    let sum = 0, amp = 1, total = 0, freq = 1;
    for (let o = 0; o < octaves; o++) { sum += noise(x * freq, seed + o * 7919) * amp; total += amp; amp *= .5; freq *= 2; }
    return sum / total;
  }
  /** A small seeded generator for placing props. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  /** Ordered-dithers a 0..1 value into one of `levels` whole steps, so gradients and light falloff stay in palette. */
  function dither(value, levels, x, y) {
    const step = Math.floor(value * (levels - 1) + (BAYER[((y & 3) << 2) | (x & 3)] + .5) / 16);
    return step < 0 ? 0 : step >= levels ? levels - 1 : step;
  }
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  /* ---------- Palette ---------- */

  /** Parses a #rrggbb colour. */
  function rgb(hex) { const n = parseInt(hex.trim().replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  /** Converts RGB to hue (degrees), saturation and lightness. */
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  /** Converts hue, saturation and lightness back to RGB. */
  function fromHsl(h, s, l) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  }
  /** Packs RGB into the canvas's little-endian RGBA word. */
  const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const css = ([r, g, b]) => `rgb(${r} ${g} ${b})`;

  /** Builds the 16-colour palette; the warm ramps are hue-shifted from the icon red the page was rendered with. */
  function makePalette() {
    const declared = getComputedStyle(root).getPropertyValue('--cinnabar-red');
    const base = /^#?[0-9a-f]{6}$/i.test(declared.trim()) ? rgb(declared) : [184, 40, 30];
    const [h, s, l] = toHsl(base);
    const tone = (dh, ds, dl) => fromHsl((h + dh + 360) % 360, clamp01(s * ds), clamp01(l * dl));
    const colours = {
      ground: rgb('#0b0708'), n1: rgb('#0e1322'), n2: rgb('#151d33'), n3: rgb('#1f2b47'), n4: rgb('#304262'),
      n5: rgb('#52698d'), star: rgb('#dbe4f2'),
      oxide: tone(-6, .62, .27), rust: tone(-3, .78, .48), ruby: tone(-1, .94, .76), red: base,
      ember: tone(3, 1.02, 1.3), coral: tone(8, 1.16, 1.6), glint: tone(18, 1.3, 2.05),
      ochre: tone(26, .85, 1.14), gold: tone(38, 1.2, 1.55),
    };
    const word = {}, style = {};
    Object.keys(colours).forEach(name => { word[name] = pack(colours[name]); style[name] = css(colours[name]); });
    return { word, style };
  }

  /* ---------- Pixel buffers ---------- */

  /** An offscreen RGBA buffer addressed in whole native pixels. */
  function buffer(w, h) {
    const image = new ImageData(w, h);
    return { w, h, image, px: new Uint32Array(image.data.buffer) };
  }
  /** Writes one pixel, ignoring anything outside the buffer. */
  function put(b, x, y, c) { if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.px[y * b.w + x] = c; }
  /** Turns a finished buffer into a canvas that can be composited every frame. */
  function bake(b) {
    const c = document.createElement('canvas');
    c.width = b.w; c.height = b.h;
    c.getContext('2d').putImageData(b.image, 0, 0);
    return c;
  }
  /** A 1-bit silhouette mask the lighting pass colours afterwards. */
  function mask(w, h) {
    const m = new Uint8Array(w * h);
    return { w, h, m, on: (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1, set(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1; } };
  }
  /** Fills a rectangle into a mask. */
  function fillRect(k, x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) k.set(i, j); }

  /** Colours a silhouette: unlit body, a rim on edges facing up or toward the light, dithered by distance to the ore. */
  function shade(k, out, light, opts) {
    for (let y = 0; y < k.h; y++) {
      for (let x = 0; x < k.w; x++) {
        if (!k.on(x, y)) continue;
        const toward = light.x > x ? 1 : -1;
        const top = !k.on(x, y - 1), side = !k.on(x + toward, y);
        const glow = light.at(x, y) * opts.gain;
        let colour;
        if (top || side) colour = opts.rim[dither(glow, opts.rim.length, x, y)];
        else if (!k.on(x, y - 2) && opts.inner) colour = opts.inner[dither(glow * .8, opts.inner.length, x, y)];
        else {
          const depth = opts.fade ? clamp01((y - opts.fade.from) / opts.fade.span) : 0;
          colour = opts.body[dither(depth, opts.body.length, x, y)];
          if (opts.wash && glow > .05) { const w = dither(glow * opts.wash.gain, opts.wash.ramp.length + 1, x, y); if (w) colour = opts.wash.ramp[w - 1]; }
        }
        put(out, x, y, colour);
      }
    }
  }

  /* ---------- Authored sprites ---------- */

  // A cinnabar ore block, 8x8: stone with clustered red grains and one bright facet per cluster.
  const ORE = [
    '........',
    '.rr...e.',
    '.rec..rr',
    '..r.....',
    '.....rr.',
    '.e..recr',
    '.rr..rr.',
    '........',
  ];
  // A player standing at the hill's edge, head, arms and legs in whole pixels.
  const PLAYER = [
    '..xxxx..', '..xxxx..', '..xxxx..', '..xxxx..',
    'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'x.xxxx.x', 'x.xxxx.x',
    '..xxxx..', '..xxxx..', '..xxxx..', '..xx.x..', '..xx.x..', '..xx.x..',
  ];

  /** Draws a voxel tree into a silhouette mask; spruces step out in tiers, oaks carry a squared canopy. */
  function tree(k, x, ground, kind, size) {
    if (kind === 'spruce') {
      const tiers = [1, 1, 3, 3, 5, 3, 5, 7, 5, 7, 9, 7, 9, 11].slice(0, size);
      const top = ground - tiers.length - 2;
      tiers.forEach((w, i) => fillRect(k, x - (w >> 1), top + i, w, 1));
      fillRect(k, x, ground - 2, 1, 3);
    } else {
      const trunk = 3 + (size % 3), w = 7 + (size % 2) * 2, h = 5 + (size % 3);
      fillRect(k, x, ground - trunk, 2, trunk + 1);
      const cx = x + 1 - (w >> 1), cy = ground - trunk - h;
      fillRect(k, cx + 1, cy, w - 2, h);
      fillRect(k, cx, cy + 1, w, h - 2);
      fillRect(k, cx + 2, cy - 2, w - 4, 2);
    }
  }

  /** Draws one crystal shard from its base, upward by default or downward from a roof: a lit face, a shaded face and a pointed tip. */
  function shard(out, glints, P, bx, base, w, h, lean, down) {
    for (let r = 0; r < h; r++) {
      const y = down ? base + r : base - 1 - r;
      const taper = Math.max(0, r - (h - w * 2));
      const width = Math.max(1, w - Math.ceil(taper / 2));
      const cx = bx + Math.trunc((lean * r) / 6);
      const left = cx - (width >> 1);
      for (let i = 0; i < width; i++) {
        const x = left + i, edge = i === 0, lit = i < Math.ceil(width / 2);
        let c = lit ? P.ember : P.red;
        if (edge && width > 1) c = P.coral;
        if (i === width - 1 && width > 2) c = P.ruby;
        if (width === 1) c = r === h - 1 ? P.glint : P.coral;
        if (lit && i === 1 && r > 2 && r < h - 4 && (r + bx) % 5 < 3) c = P.glint;
        put(out, x, y, c);
        if (lit) glints.push(x, y);
      }
    }
  }

  /* ---------- The surface: night over blocky hills, lit from below by a cinnabar formation ---------- */

  function buildSurface(W, H, P, side) {
    const narrow = W < 240;
    const random = rng(SEED);
    const horizon = Math.round(H * .64);
    // On a phone the formation stands at the very edge, clear of the centred download text.
    const ox = narrow ? (side > 0 ? W - 8 : 8) : Math.round(W / 2 + side * Math.min(W * .27, 200));
    const crest = Math.round(H * (narrow ? .72 : .7));
    const reach = Math.max(80, Math.min(W * .6, 250));
    const lights = [{ x: ox, y: crest - 8, r: reach, k: 1 }];
    const light = {
      x: ox,
      at(x, y) {
        let best = 0;
        for (const l of lights) {
          const d = Math.hypot(x - l.x, (y - l.y) * 1.3) / l.r;
          if (d < 1) best = Math.max(best, Math.pow(1 - d, 1.8) * l.k);
        }
        return best;
      },
    };
    const world = x => x - Math.round(W / 2) + 4096;

    // Sky, extended upward so parallax never runs out of sky.
    const ext = Math.ceil(H * .5) + 4;
    const sky = buffer(W, H + ext);
    const skyRamp = [P.ground, P.n1, P.n2, P.n3, P.n4];
    for (let y = 0; y < sky.h; y++) {
      const sy = y - ext;
      const g = Math.pow(clamp01((sy + ext * .55) / (horizon + ext * .55)), 1.5);
      for (let x = 0; x < W; x++) {
        let c = skyRamp[dither(g, skyRamp.length, x, y)];
        // A low warm haze hugs the horizon around the ore; the sky above it stays night.
        const haze = sy > horizon * .6 ? Math.pow(light.at(x, sy), 2.6) * .55 * clamp01((sy - horizon * .6) / (horizon * .4)) : 0;
        if (haze > 0 && dither(haze, 2, x, y)) c = P.oxide;
        sky.px[y * W + x] = c;
      }
    }

    // A waxing gibbous moon: a pixel disc lit from the upper left, a dithered terminator, rimmed craters and a two-step halo.
    const ms = narrow ? 11 : 17;
    const mx = Math.round(W * (narrow ? .8 : .13)), my = Math.round(H * (narrow ? .245 : .18)) + ext;
    const mr = ms / 2, mcx = mx + mr, mcy = my + mr;
    for (let y = my - 9; y < my + ms + 9; y++) {
      for (let x = mx - 9; x < mx + ms + 9; x++) {
        const d = Math.hypot(x + .5 - mcx, y + .5 - mcy) - mr;
        if (d <= 0 || d > 8) continue;
        const t = 1 - d / 8;
        const level = dither(t * t * .8 + (d < 1.2 ? .4 : 0), 3, x, y);
        if (level) put(sky, x, y, level === 2 ? P.n4 : P.n3);
      }
    }
    // Craters as [x, y, radius] on the face; each sinks one step and catches light on its lower-right rim.
    const craters = narrow ? [[3.5, 4, 1.1], [6, 7.5, .9]] : [[5.5, 6, 1.6], [10.5, 4, 1], [8, 12, 1.3]];
    const ramp = [P.n3, P.n4, P.n5, P.star];
    for (let dy = 0; dy < ms; dy++) {
      for (let dx = 0; dx < ms; dx++) {
        const px = dx + .5, py = dy + .5;
        const dist = Math.hypot(px - mr, py - mr);
        if (dist > mr) continue;
        const u = (px - mr) / mr, v = (py - mr) / mr;
        // Lit from the upper left; the terminator crosses the right third in a dithered band.
        let level = dither(clamp01((.62 - u - v * .25) / .6), ramp.length, mx + dx, my + dy);
        if (dist > mr - 1 && level > 1) level--;
        for (const [a, b, cr] of craters) {
          const cd = Math.hypot(px - a, py - b);
          if (cd <= cr) level = Math.max(0, level - 1);
          else if (cd <= cr + 1 && px > a && py > b && level > 1) level = Math.min(ramp.length - 1, level + 1);
        }
        put(sky, mx + dx, my + dy, ramp[level]);
      }
    }

    // Stars: dim, mid, bright and four-point; about a third twinkle on their own clocks.
    const stars = [];
    const starCount = Math.round(W * (horizon + ext) * .0045);
    for (let i = 0; i < starCount; i++) {
      const x = Math.floor(random() * W), y = Math.floor(random() * (horizon + ext - 10));
      if (x > mx - 12 && x < mx + ms + 12 && y > my - 12 && y < my + ms + 12) continue;
      const r = random(), sy = y - ext;
      const kind = r < .52 ? 0 : r < .84 ? 1 : r < .97 ? 2 : 3;
      // Stars thin out toward the warm haze and the horizon.
      if (sy > horizon * .55 && random() < .7) continue;
      stars.push({ x, y, kind, twinkle: random() < .34, period: 18 + Math.floor(random() * 40), phase: Math.floor(random() * 60) });
    }

    // Flat block clouds in two decks.
    const clouds = [];
    const deck = (count, top, bottom, speed, body) => {
      for (let i = 0; i < count; i++) {
        const w = 2 * (8 + Math.floor(random() * 18)), h = 2 * (2 + Math.floor(random() * 2));
        const sprite = buffer(w + 8, h + 4);
        const k = mask(sprite.w, sprite.h);
        fillRect(k, 0, 4, w, h);
        const bump = 2 * (3 + Math.floor(random() * (w / 6)));
        fillRect(k, 2 * Math.floor(random() * ((w - bump) / 2)), 2, bump, 2);
        if (random() < .6) fillRect(k, w - 6, 6, 14, h - 2);
        for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) {
          if (!k.on(x, y)) continue;
          put(sprite, x, y, !k.on(x, y - 1) ? P.n3 : !k.on(x, y + 1) ? P.n1 : body);
        }
        clouds.push({ canvas: bake(sprite), x: Math.floor(random() * (W + 120)), y: Math.round(top + random() * (bottom - top)), speed, w: sprite.w });
      }
    };
    deck(Math.max(2, Math.round(W / 110)), H * .08, H * .3, 9, P.n2);
    deck(Math.max(2, Math.round(W / 90)), H * .3, H * .5, 6, P.n2);

    // Far range: stepped peaks in the haze.
    const far = buffer(W, H), farMask = mask(W, H);
    const farBase = horizon + Math.round(H * .05);
    for (let x = 0; x < W; x++) {
      const col = Math.floor(world(x) / 4);
      const v = Math.pow(fbm(col * .085, SEED + 11, 3), 1.25);
      const top = Math.round((farBase - v * H * .26) / 2) * 2;
      for (let y = top; y < H; y++) farMask.set(x, y);
    }
    shade(farMask, far, light, { gain: .55, rim: [P.n3, P.n3, P.oxide, P.rust], body: [P.n2, P.n2, P.n1], fade: { from: farBase - H * .12, span: H * .2 } });

    // Mid hills with spruce and oak, and one player watching the light.
    const mid = buffer(W, H), midMask = mask(W, H);
    const midBase = Math.round(H * .8);
    const midTop = x => Math.round((midBase - fbm(Math.floor(world(x) / 4) * .06, SEED + 23, 3) * H * .16) / 2) * 2;
    for (let x = 0; x < W; x++) for (let y = midTop(x); y < H; y++) midMask.set(x, y);
    const px = Math.max(10, Math.min(W - 18, Math.round(ox - side * Math.max(46, W * .36))));
    let pg = H; for (let i = 0; i < 8; i++) pg = Math.min(pg, midTop(px + i));
    const trees = rng(SEED + 5);
    for (let x = 2 + Math.floor(trees() * 6); x < W; x += 5 + Math.floor(trees() * 13)) {
      if (Math.abs(x - ox) < (narrow ? 22 : 34) || Math.abs(x - px - 4) < 12 || trees() < .35) continue;
      tree(midMask, x, midTop(x), trees() < .55 ? 'spruce' : 'oak', 6 + Math.floor(trees() * 9));
    }
    PLAYER.forEach((row, j) => [...row].forEach((c, i) => { if (c === 'x') midMask.set(px + i, pg - PLAYER.length + j); }));
    shade(midMask, mid, light, { gain: 1.05, rim: [P.n2, P.n2, P.n2, P.n2, P.oxide, P.rust, P.ruby], inner: [P.n1], body: [P.n1] });

    // Near ridge and the promontory of stone blocks that carries the formation.
    const near = buffer(W, H), nearMask = mask(W, H);
    const nearBase = Math.round(H * .88);
    const steps = [6, 5, 4, 4, 2, 1, 0, 0, 1, 1, 3, 4, 5, 6];
    const block = 8, bx0 = ox - 7 * block;
    const nearTop = x => {
      let top = Math.round((nearBase - fbm(Math.floor(world(x) / 6) * .18, SEED + 31, 2) * H * .05) / 2) * 2;
      const c = Math.floor((x - bx0) / block);
      if (c >= 0 && c < steps.length) top = Math.min(top, crest + steps[side > 0 ? c : steps.length - 1 - c] * block);
      return top;
    };
    for (let x = 0; x < W; x++) for (let y = nearTop(x); y < H; y++) nearMask.set(x, y);
    shade(nearMask, near, light, { gain: 1.25, rim: [P.n1, P.oxide, P.rust, P.ruby, P.red, P.ember], inner: [P.ground, P.oxide, P.rust], body: [P.ground],
      wash: { gain: .85, ramp: [P.ground, P.oxide, P.oxide, P.rust] } });
    // Block seams and grain on the promontory, visible only where the ore lights them.
    for (let y = crest; y < H; y++) {
      for (let x = bx0; x < bx0 + steps.length * block; x++) {
        if (!nearMask.on(x, y) || !nearMask.on(x, y - 1)) continue;
        const glow = light.at(x, y) * 1.2;
        if (glow < .12) continue;
        const seam = (x - bx0) % block === 0 || (y - crest) % block === 0;
        const grain = hash2(x, y, 3) < .1;
        if (seam) put(near, x, y, P.ground);
        else if (grain) put(near, x, y, glow > .7 ? P.ruby : P.rust);
      }
    }
    // Ore blocks set into the promontory's face; each is a small light of its own.
    const glints = [];
    const oreBlocks = narrow ? [[5, 1], [9, 2]] : [[5, 1], [8, 2], [3, 3], [10, 3]];
    oreBlocks.forEach(([c, r]) => {
      const col = side > 0 ? c : steps.length - 1 - c;
      const bx = bx0 + col * block, by = crest + (steps[c] + r) * block;
      lights.push({ x: bx + 4, y: by + 4, r: 26, k: .7 });
      ORE.forEach((row, j) => [...row].forEach((ch, i) => {
        const x = bx + i, y = by + j;
        if (!nearMask.on(x, y)) return;
        if (ch === '.') { if (i === 0 || j === 0) put(near, x, y, P.oxide); else put(near, x, y, hash2(x, y, 9) < .3 ? P.rust : P.oxide); return; }
        put(near, x, y, ch === 'r' ? P.red : ch === 'e' ? P.ember : P.coral);
        if (ch !== 'r') glints.push(x, y);
      }));
    });
    // The crystal formation: the scene's light source.
    const scale = narrow ? .8 : 1.3;
    const shards = [[-12, 3, 9, -2], [-7, 4, 16, -1], [-2, 5, 27, 0], [3, 4, 20, 1], [7, 3, 12, 2], [11, 2, 7, 2]];
    shards.forEach(([dx, w, h, lean]) => shard(near, glints, P, ox + Math.round(dx * scale) * side, crest, w, Math.round(h * scale), lean * side));
    for (let x = ox - 14; x <= ox + 14; x++) if (nearMask.on(x, crest) && !nearMask.on(x, crest - 1)) put(near, x, crest, hash2(x, 1, 4) < .5 ? P.ember : P.red);

    // Foreground: the ground the page stands on, with grass tips catching the glow.
    const fore = buffer(W, H), foreMask = mask(W, H);
    const groundY = Math.round(H * .945);
    for (let x = 0; x < W; x++) {
      const top = groundY - Math.round(noise(world(x) / 5, SEED + 41) * 3) * 2;
      for (let y = top; y < H; y++) foreMask.set(x, y);
      const blade = hash(world(x), SEED + 43);
      if (blade < .45) fillRect(foreMask, x, top - 1 - Math.floor(blade * 6), 1, 1 + Math.floor(blade * 6));
    }
    shade(foreMask, fore, { x: ox, at: (x, y) => light.at(x, y) }, { gain: 1.1, rim: [P.n1, P.n1, P.oxide, P.rust, P.ruby], body: [P.ground] });

    // Embers start from the shard tips.
    const vents = shards.map(([dx, , h]) => ({ x: ox + Math.round(dx * scale) * side, y: crest - Math.round(h * scale) }));
    return { kind: 'surface', W, H, ext, sky: bake(sky), stars, clouds, far: bake(far), mid: bake(mid), near: bake(near), fore: bake(fore), glints, vents, ox, crest };
  }

  /* ---------- The deep: a cave chamber under the world, its walls veined with cinnabar ---------- */

  function buildDeep(W, H, P) {
    const narrow = W < 240;
    const B = 8, cols = Math.ceil(W / B), rows = Math.ceil(H / B);
    const cx = W / 2, cy = H * .5, rx = W * (narrow ? .47 : .36), ry = H * .4;
    const air = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const bx = i * B + B / 2, by = j * B + B / 2;
      const d = Math.pow((bx - cx) / rx, 2) + Math.pow((by - cy) / ry, 2) + (hash2(i, j, 21) - .5) * .5;
      if (d < 1 && j > 1 && j < rows - 2) air[j * cols + i] = 1;
    }
    const isAir = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && air[j * cols + i] === 1;
    const random = rng(SEED + 77);
    // Ore sits in the chamber walls: solid blocks that touch air, spread around the rim.
    const ore = [];
    const wall = [];
    for (let j = 1; j < rows - 1; j++) for (let i = 0; i < cols; i++) {
      if (isAir(i, j)) continue;
      if (isAir(i - 1, j) || isAir(i + 1, j) || isAir(i, j - 1) || isAir(i, j + 1)) wall.push([i, j]);
    }
    const wanted = narrow ? 6 : 11;
    for (let n = 0; n < wanted * 6 && ore.length < wanted; n++) {
      const [i, j] = wall[Math.floor(random() * wall.length)] || [0, 0];
      if (ore.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < 4)) continue;
      ore.push([i, j]);
      if (random() < .5) { const [a, b] = random() < .5 ? [i + 1, j] : [i, j + 1]; if (!isAir(a, b)) ore.push([a, b]); }
    }
    // A few ore blocks deeper in the rock too.
    for (let n = 0; n < (narrow ? 2 : 5); n++) ore.push([Math.floor(random() * cols), 2 + Math.floor(random() * (rows - 5))]);
    const isOre = (i, j) => ore.some(([a, b]) => a === i && b === j);
    const lights = ore.filter(([i, j]) => !isAir(i, j)).map(([i, j]) => ({ x: i * B + 4, y: j * B + 4, r: narrow ? 26 : 34 }));
    // Crystals hang from the chamber roof and grow from its floor.
    const out = buffer(W, H);
    const glints = [];
    const at = (x, y) => {
      let best = 0;
      for (const l of lights) { const d = Math.hypot(x - l.x, y - l.y) / l.r; if (d < 1) best = Math.max(best, Math.pow(1 - d, 1.6)); }
      return best;
    };
    for (let y = 0; y < H; y++) {
      const j = Math.floor(y / B);
      for (let x = 0; x < W; x++) {
        const i = Math.floor(x / B), lx = x % B, ly = y % B;
        const glow = at(x, y);
        let c;
        if (isAir(i, j)) {
          // The chamber's back wall: near-black, warmed only right next to the ore.
          c = dither(glow * .4, 2, x, y) ? P.oxide : P.ground;
        } else if (j >= rows - 2) {
          // Bedrock: broken black with cold flecks.
          c = hash2(x >> 1, y >> 1, 55) < .22 ? P.n1 : P.ground;
        } else {
          const edge = isAir(i - 1, j) && lx === 0 || isAir(i + 1, j) && lx === B - 1 || isAir(i, j - 1) && ly === 0 || isAir(i, j + 1) && ly === B - 1;
          const seam = lx === 0 || ly === 0;
          const n = hash2(x, y, 31 + i * 3 + j);
          const steps = [P.ground, P.n1, P.n1, P.oxide, P.rust];
          let level = dither(Math.min(1, glow * .95 + (n < .25 ? .1 : 0) + .2), steps.length, x, y);
          if (seam && level > 0) level--;
          if (edge) level = Math.min(steps.length - 1, level + 1);
          c = steps[level];
          if (isOre(i, j)) {
            const ch = ORE[ly][lx];
            if (ch !== '.') { c = ch === 'r' ? P.red : ch === 'e' ? P.ember : P.coral; if (ch !== 'r') glints.push(x, y); }
            else c = seam ? P.oxide : n < .3 ? P.rust : P.oxide;
          }
        }
        // The top rows rise out of the page ground through a dither.
        if (y < B * 2 && dither(1 - y / (B * 2), 2, x, y)) c = P.ground;
        out.px[y * W + x] = c;
      }
    }
    // Shards from the roof (pointing down) and the floor (pointing up), only where the rock meets the chamber.
    const roof = [], floor = [];
    for (let i = 0; i < cols; i++) for (let j = 2; j < rows - 2; j++) {
      if (!isAir(i, j) && isAir(i, j + 1)) roof.push([i, j]);
      if (!isAir(i, j) && isAir(i, j - 1)) floor.push([i, j]);
    }
    const crystals = [];
    const pick = (list, n) => { for (let k = 0; k < n && list.length; k++) crystals.push(list.splice(Math.floor(random() * list.length), 1)[0]); };
    pick(roof, narrow ? 2 : 4); const roofCount = crystals.length; pick(floor, narrow ? 2 : 4);
    crystals.forEach(([i, j], n) => {
      const down = n < roofCount, x = i * B + 2 + Math.floor(random() * 4);
      const h = 6 + Math.floor(random() * (narrow ? 8 : 12)), w = 2 + Math.floor(random() * 2);
      shard(out, glints, P, x, down ? (j + 1) * B : j * B, w, h, 0, down);
    });
    return { kind: 'deep', W, H, rock: bake(out), glints };
  }

  /* ---------- One live scene per canvas ---------- */

  function Scene(canvas) {
    const host = canvas.parentElement;
    const bloom = host.querySelector('.scene-bloom');
    const ctx = canvas.getContext('2d');
    const bctx = bloom && bloom.getContext('2d');
    const kind = canvas.dataset.scene;
    const side = canvas.dataset.ore === 'left' ? -1 : 1;
    const parallax = canvas.dataset.parallax !== 'off';
    let P, world, scale = 1, dpr = 1, tick = 0, last = 0, visible = true, raf = 0, embers = [], sweep = -999, lastOffset = -1;

    /** Picks a whole device-pixel scale, sizes the canvas to cover its host, and rebuilds the world. */
    function layout() {
      const cssW = host.clientWidth, cssH = host.clientHeight;
      if (!cssW || !cssH) return;
      dpr = window.devicePixelRatio || 1;
      const art = cssW >= 1200 ? 4 : cssW >= 640 ? 3 : 2;
      scale = Math.max(1, Math.round(art * dpr));
      const W = Math.ceil(cssW * dpr / scale), H = Math.ceil(cssH * dpr / scale);
      if (world && world.W === W && world.H === H) return;
      canvas.width = W; canvas.height = H;
      canvas.style.width = `${W * scale / dpr}px`; canvas.style.height = `${H * scale / dpr}px`;
      if (bloom) { bloom.width = W; bloom.height = H; bloom.style.width = canvas.style.width; bloom.style.height = canvas.style.height; }
      host.style.setProperty('--px', `${scale / dpr}px`);
      P = P || makePalette();
      world = kind === 'deep' ? buildDeep(W, H, P.word) : buildSurface(W, H, P.word, side);
      embers = [];
      draw();
    }

    const moving = () => root.dataset.fx !== 'off' && !reduceQuery.matches;

    /** Scroll offset into the host in native pixels, for whole-pixel parallax. */
    function offset() {
      if (!parallax || !moving() || kind !== 'surface') return 0;
      const top = host.getBoundingClientRect().top;
      return Math.max(0, Math.round(-top * dpr / scale));
    }

    /** Advances the attract loop one tick: twinkles, clouds, embers and the glint sweep. */
    function step() {
      tick++;
      if (world.vents) {
        if (embers.length < 9 && tick % 5 === 0) {
          const v = world.vents[(tick * 7) % world.vents.length];
          embers.push({ x: v.x, y: v.y - 1, age: 0, life: 22 + (tick * 13) % 26, drift: (tick % 3) - 1 });
        }
        embers.forEach(e => { e.age++; if (e.age % 2 === 0) e.y--; if (e.age % 7 === 0) e.x += e.drift; });
        embers = embers.filter(e => e.age < e.life);
      }
      if (tick % 54 === 0) sweep = 0; else if (sweep >= 0) sweep += 3;
      if (sweep > 140) sweep = -999;
    }

    /** Composites the layers at whole-pixel parallax offsets and overlays the live pixels. */
    function draw() {
      if (!world) return;
      const W = world.W, H = world.H, s = P.style;
      ctx.imageSmoothingEnabled = false;
      if (world.kind === 'deep') {
        ctx.drawImage(world.rock, 0, 0);
      } else {
        const o = offset(); lastOffset = o;
        const at = f => Math.round(o * f);
        ctx.drawImage(world.sky, 0, -world.ext + at(.5));
        const skyY = -world.ext + at(.5);
        const shades = [s.n4, s.n5, s.star];
        for (const star of world.stars) {
          let level = star.kind === 3 ? 2 : star.kind;
          if (star.twinkle && (tick + star.phase) % star.period < 4) level--;
          if (level < 0) continue;
          ctx.fillStyle = shades[level];
          const y = star.y + skyY;
          ctx.fillRect(star.x, y, 1, 1);
          if (star.kind === 3 && level === 2) {
            ctx.fillStyle = s.n5;
            ctx.fillRect(star.x - 1, y, 1, 1); ctx.fillRect(star.x + 1, y, 1, 1); ctx.fillRect(star.x, y - 1, 1, 1); ctx.fillRect(star.x, y + 1, 1, 1);
          }
        }
        for (const cloud of world.clouds) {
          const span = W + cloud.w + 40;
          const x = ((cloud.x + Math.floor(tick / cloud.speed)) % span) - cloud.w - 20;
          ctx.drawImage(cloud.canvas, x, cloud.y + at(cloud.speed > 7 ? .45 : .38));
        }
        ctx.drawImage(world.far, 0, at(.26));
        ctx.drawImage(world.mid, 0, at(.14));
        const ny = at(.06);
        ctx.drawImage(world.near, 0, ny);
        for (const e of embers) {
          const t = e.age / e.life;
          ctx.fillStyle = t < .2 ? s.glint : t < .45 ? s.coral : t < .7 ? s.ember : s.ruby;
          ctx.fillRect(e.x, e.y + ny, 1, 1);
        }
        overlayGlints(ny);
        ctx.drawImage(world.fore, 0, 0);
      }
      if (world.kind === 'deep') overlayGlints(0);
      if (bctx && root.dataset.fx !== 'off') { bctx.clearRect(0, 0, W, H); bctx.drawImage(canvas, 0, 0); }
    }

    /** Runs the diagonal glint across lit crystal faces and ore facets, and a few slow sparkles. */
    function overlayGlints(dy) {
      const g = world.glints;
      ctx.fillStyle = P.style.glint;
      for (let k = 0; k < g.length; k += 2) {
        const x = g[k], y = g[k + 1];
        const d = (x - y) - (sweep - 60);
        const lit = sweep >= 0 && (d === 0 || d === 1);
        const sparkle = hash2(x, y + Math.floor(tick / 9), 13) < .02;
        if (lit || sparkle) ctx.fillRect(x, y + dy, 1, 1);
      }
    }

    function loop(now) {
      raf = 0;
      if (!running()) return;
      if (now - last >= TICK) { last = now; step(); draw(); }
      else if (kind === 'surface' && offset() !== lastOffset) draw();
      raf = requestAnimationFrame(loop);
    }
    const running = () => visible && !document.hidden && moving();

    /** Starts the attract loop when the scene can move, or settles on one still frame. */
    function update() {
      if (running()) { if (!raf) raf = requestAnimationFrame(loop); }
      else { if (raf) cancelAnimationFrame(raf); raf = 0; if (!moving()) { tick = 0; sweep = -999; embers = []; } draw(); }
    }

    layout();
    if ('ResizeObserver' in window) new ResizeObserver(() => { layout(); }).observe(host);
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[entries.length - 1].isIntersecting; update(); }).observe(host);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('arcade:fx', update);
    reduceQuery.addEventListener?.('change', update);
    update();
  }

  canvases.forEach(Scene);
})();
