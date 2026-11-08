const { deflateSync } = require('node:zlib');

/** Encode the u32 LEB lengths used in component sections. */
function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}

/** Frame a PNG chunk with its real CRC, allowing corrupt-pixel fixtures with valid framing. */
function chunk(kind, data) {
  const body = Buffer.concat([Buffer.from(kind), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}

/** Make a complete RGBA PNG, including non-square and corrupt compressed-data variants. */
function png(width = 8, height = 8, broken = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    const cross = x === 3 || x === 4 || y === 3 || y === 4;
    rows.set(cross ? [249, 193, 85, 255] : [33, 62, 91, 255], offset);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', broken ? Buffer.from('invalid deflate data') : deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Build a component, preserving top-level section order and nested test components. */
function component(sections = []) {
  return Buffer.concat([Buffer.from([0,97,115,109,13,0,1,0]), ...sections.map(([name, data]) => {
    const body = typeof name === 'number' ? data : Buffer.concat([leb(Buffer.byteLength(name)), Buffer.from(name), data]);
    return Buffer.concat([Buffer.from([typeof name === 'number' ? name : 0]), leb(body.length), body]);
  })]);
}

const ICON = 'cinnabar:extension/icon@1';
module.exports = { png, chunk, component, ICON };
