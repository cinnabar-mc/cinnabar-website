(function (root) {
  'use strict';
  const HASH = /^[a-f0-9]{64}$/;

  /** Restore descriptors only; selected files and previews never go into browser storage. */
  function restoreImages(saved) {
    return (Array.isArray(saved) ? saved : []).filter(item => item && typeof item.sha256 === 'string' && HASH.test(item.sha256)
      && typeof item.name === 'string' && typeof item.caption === 'string' && typeof item.alt === 'string')
      .map(item => ({ sha256: item.sha256, name: item.name, caption: item.caption, alt: item.alt, file: null, url: null }));
  }

  /** Incomplete or invalid server policy cannot enable gallery selection. */
  function validLimits(limits) {
    return Boolean(limits) && ['images', 'image_bytes', 'image_dimension', 'image_pixels', 'caption_chars', 'alt_chars']
      .every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0);
  }

  /** Reject oversized raster headers before asking the browser to decode pixels. */
  function dimensions(bytes, limits) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
    let width, height, type;
    if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && tag(12) === 'IHDR') {
      type = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
      for (let at = 8; at + 12 <= bytes.length;) {
        const size = view.getUint32(at);
        if (size > bytes.length - at - 12) throw new Error('The PNG is truncated.');
        if (tag(at + 4) === 'acTL') throw new Error('Choose a still image.');
        at += size + 12;
      }
    } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216) {
      type = 'image/jpeg';
      for (let at = 2; at + 4 <= bytes.length;) {
        if (bytes[at++] !== 255) break;
        while (bytes[at] === 255) at++;
        const marker = bytes[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (at + 2 > bytes.length) break;
        const size = view.getUint16(at);
        if (size < 2 || size > bytes.length - at) break;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && size >= 8) {
          height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
        }
        at += size;
      }
    } else if (bytes.length >= 25 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
      type = 'image/webp';
      if (tag(12) === 'VP8X' && bytes.length >= 30) {
        if (bytes[20] & 2) throw new Error('Choose a still image.');
        const u24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
        width = u24(24) + 1; height = u24(27) + 1;
      } else if (tag(12) === 'VP8L' && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (tag(12) === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
      }
    }
    if (!width || !height || width > limits.image_dimension || height > limits.image_dimension
      || width * height > limits.image_pixels) throw new Error('Choose a PNG, JPEG or WebP image up to ' + limits.image_dimension + ' pixels per side.');
    return { width, height, type };
  }

  /** Fully decode a bounded raster and create a small inert preview, keeping its original upload bytes. */
  async function prepareImage(file, limits) {
    if (!validLimits(limits)) throw new Error('Reload to retrieve image upload limits.');
    if (file.size > limits.image_bytes) throw new Error('Each screenshot must be at most ' + Math.floor(limits.image_bytes / 1024) + ' KiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = dimensions(bytes, limits);
    let bitmap;
    try {
      const scale = Math.min(1, 320 / size.width, 180 / size.height);
      const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale));
      bitmap = await createImageBitmap(new Blob([bytes], { type: size.type }), { resizeWidth: width, resizeHeight: height });
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
      return { file, name: file.name, sha256, caption: '', alt: '', url: canvas.toDataURL('image/png') };
    } catch (_) { throw new Error('This image could not be decoded. Choose another PNG, JPEG or WebP.'); }
    finally { bitmap?.close(); }
  }

  /** Recover only the same account's exact immutable upload, including ordered images and listing text. */
  function receipt(versions, attempt) {
    return (Array.isArray(versions) ? versions : []).find(version => version.creator === attempt.owner
      && version.slug === attempt.fields.slug && version.version === attempt.fields.version && version.sha256 === attempt.sha256
      && ['name', 'summary', 'description', 'source', 'category', 'license', 'notes'].every(key => String(version[key] ?? '') === String(attempt.fields[key] ?? ''))
      && (version.gallery || []).length === attempt.images.length
      && attempt.images.every((image, index) => {
        const stored = version.gallery[index];
        return stored.sha256 === image.sha256 && stored.caption === image.caption && (stored.alt || '') === image.alt;
      }));
  }

  const api = { restoreImages, validLimits, dimensions, prepareImage, receipt };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CinnabarUpload = api;
})(typeof window !== 'undefined' ? window : globalThis);
