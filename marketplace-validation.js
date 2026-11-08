(function (root) {
  'use strict';
  /** Run a disposable trusted validator with a deadline; uploaded code is never instantiated. */
  function validate(buffer, options = {}) {
    return new Promise(function (resolve, reject) {
      if (options.signal?.aborted) { reject(new Error('Validation cancelled.')); return; }
      const worker = new Worker('/validator/marketplace-validator-worker.js', { type: 'module' });
      let finished = false;
      const finish = function (error, result) {
        if (finished) return;
        finished = true;
        options.signal?.removeEventListener('abort', abort);
        clearTimeout(timer); worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      const abort = function () { finish(new Error('Validation cancelled.')); };
      const timer = setTimeout(function () { finish(new Error('Validation timed out. Try a smaller component or retry.')); }, 20000);
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = function (event) {
        finish(event.data.ok ? null : new Error(event.data.error), event.data.result);
      };
      worker.onerror = function () { finish(new Error('The component validator could not start. Refresh and retry.')); };
      worker.postMessage(buffer, [buffer]);
    });
  }
  /** Check PNG framing, CRCs and bounded dimensions before asking the browser to decode pixels. */
  function iconDimensions(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > 256 * 1024
      || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, dimensions = null, pixels = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return null;
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      let crc = 0xffffffff;
      for (let i = offset + 4; i < end - 4; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return null;
      if (offset === 8) {
        if (kind !== 'IHDR' || length !== 13) return null;
        const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
        if (!width || !height || width > 256 || height > 256) return null;
        dimensions = { width, height };
      } else if (kind === 'IHDR') return null;
      if (kind === 'IDAT') pixels = true;
      if (kind === 'IEND') return length === 0 && pixels ? dimensions : null;
      offset = end;
    }
    return null;
  }

  /** Decode a single optional icon without executing the component; failures keep the placeholder. */
  async function iconUrl(bytes) {
    const dimensions = iconDimensions(bytes);
    if (!dimensions) return null;
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) return null;
      // A data URL avoids object-URL lifetime leaks across editor rerenders and saved mock releases.
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return 'data:image/png;base64,' + btoa(binary);
    } catch (_) { return null; }
    finally { bitmap?.close(); }
  }
  const api = { validate, iconDimensions, iconUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CinnabarValidation = api;
})(typeof window !== 'undefined' ? window : globalThis);
