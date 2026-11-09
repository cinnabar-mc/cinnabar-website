(function () {
  "use strict";
  const content = typeof module !== "undefined" ? require("./marketplace-content.js") : window.CinnabarContent;
  const uploads = typeof module !== "undefined" ? require("./marketplace-upload.js") : window.CinnabarUpload;

  /**
   * A client for the live marketplace API. It sends the session cookie the API set after Google sign-in,
   * and repeats the CSRF token from `GET /me` on every write. Uploads go as multipart, so the API reads the
   * component's grants and hash itself.
   */
  function createHttpApi(base, fetchImpl, location, xhrFactory = typeof XMLHttpRequest === 'undefined' ? null : () => new XMLHttpRequest()) {
    let csrf = "";
    let uploadLimits = null;
    let identityGeneration = 0;
    const REQUEST_TIMEOUT_MS = 10000, UPLOAD_TIMEOUT_MS = 120000;
    base = base.replace(/\/$/, '');
    /** Resolve API icon URLs and derive legacy gallery routes from server digests. */
    function release(data, privateView) {
      if (!data || typeof data !== 'object') return data;
      const id = /^[0-9]{1,12}$/.test(String(data.id)) ? String(data.id) : null;
      const gallery = (Array.isArray(data.gallery) ? data.gallery : []).filter(item => item && /^[0-9a-f]{64}$/.test(item.sha256))
        .map(item => ({ ...item, private: privateView, url: privateView
          ? (id ? base + '/me/mods/' + id + '/media/' + item.sha256 : '') : base + '/mods/media/' + item.sha256 }));
      let icon = null;
      if (typeof data.icon === 'string' && data.icon.trim()) {
        try { icon = content.externalUrl(new URL(data.icon, base + '/').href); } catch (_) { /* use placeholder */ }
      }
      return { ...data, gallery, icon, private: privateView };
    }
    /** Send upload bytes with real progress and cancellation, never granting publication locally. */
    function upload(method, path, headers, form, options) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('Upload stopped.')); return; }
        const xhr = xhrFactory();
        let finished = false;
        const finish = (error, response) => {
          if (finished) return;
          finished = true; options.signal?.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(response);
        };
        const abort = () => { xhr.abort(); finish(new Error('Upload stopped.')); };
        xhr.open(method, base + path); xhr.withCredentials = true; xhr.timeout = UPLOAD_TIMEOUT_MS;
        for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
        xhr.upload.onprogress = event => {
          if (!finished) options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
        };
        xhr.onload = () => finish(null, { status: xhr.status, json: async () => JSON.parse(xhr.responseText) });
        xhr.onerror = () => finish(new Error('Cannot reach the marketplace.'));
        xhr.ontimeout = () => finish(new Error('Upload timed out.'));
        xhr.onabort = () => finish(new Error('Upload stopped.'));
        options.signal?.addEventListener('abort', abort, { once: true });
        xhr.send(form);
      });
    }

    const api = {
      backend: "http",
      /** Answers `{status, body}` like the mock; network failures reject. */
      request: async function (method, path, body, options = {}) {
        if (path === '/auth/signout') identityGeneration++;
        const identity = identityGeneration;
        const form = typeof FormData !== "undefined" && body instanceof FormData;
        const headers = { Accept: "application/json" };
        if (body && !form) headers["Content-Type"] = "application/json";
        if (method !== "GET") headers["X-Cinnabar-CSRF"] = csrf;
        const response = form && xhrFactory ? await upload(method, path, headers, body, options) : await fetchImpl(base + path, {
          method: method, credentials: "include", referrerPolicy: "strict-origin", headers: headers,
          body: form ? body : body ? JSON.stringify(body) : undefined,
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(form ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(form ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        });
        let invalidJson = false;
        const data = response.status === 204 ? null : await response.json().catch(function () { invalidJson = true; return { error: "The marketplace didn't answer properly. Check whether your upload was received before retrying." }; });
        const status = invalidJson && response.status >= 200 && response.status < 300 ? 502 : response.status;
        const sessionResponse = path === '/me' || path === '/me/username';
        if (sessionResponse && status === 200 && identity === identityGeneration) {
          csrf = data && typeof data.csrf === "string" ? data.csrf : '';
          uploadLimits = data?.upload_limits || null;
        }
        if (path === '/auth/signout' && (response.status === 200 || response.status === 204)) { csrf = ''; uploadLimits = null; }
        const privateView = path === '/me/mods' || path.startsWith('/staff/') || path === '/submissions';
        const bodyData = status === 200 && !sessionResponse
          ? (Array.isArray(data) ? data.map(item => release(item, privateView)) : release(data, privateView)) : data;
        return { status, body: bodyData };
      },
      /** Leaves for Google sign-in, returning to this exact page. */
      signIn: function () {
        location.assign(base + "/auth/google/start?return_to=" + encodeURIComponent(location.href));
      },
      /** Link to an authenticated attachment download of the exact submitted release. */
      fileUrl: function (id) { return /^[0-9]{1,12}$/.test(String(id)) ? base + '/staff/versions/' + id + '/file' : null; },
      /** Upload the component and ordered optional screenshots; icons still travel inside the component. */
      submit: async function (fields, file, options = {}) {
        if (!options || Array.isArray(options)) options = {};
        const fail = message => ({ status: 422, body: { error: message + ' Your draft has been retained.' } });
        if (String(fields.description || "").length > 40000) return fail('Descriptions can have up to 40,000 characters.');
        if (!file || file.size > 16 * 1024 * 1024) return fail('Choose a component up to 16 MiB.');
        const images = Array.isArray(options.images) ? options.images : [];
        if (images.length && (!uploads.validLimits(uploadLimits) || images.length > uploadLimits.images
          || images.some(item => !(item.file instanceof Blob) || item.file.size > uploadLimits.image_bytes))) {
          return fail('Reload to retrieve screenshot limits and check your selected images.');
        }
        const form = new FormData();
        const listing = { ...fields }; delete listing.gallery; delete listing.images; delete listing.icon;
        form.set("listing", JSON.stringify(listing));
        form.set("file", file);
        if (images.length) {
          for (const image of images) form.append('images', image.file);
          form.set('image_metadata', JSON.stringify(images.map(image => ({ caption: image.caption, alt: image.alt }))));
        }
        return api.request("POST", "/submissions", form, options);
      },
    };
    return api;
  }

  if (typeof module !== "undefined") module.exports = { createHttpApi: createHttpApi };
  if (typeof window !== "undefined") window.CinnabarMarketHttp = { createHttpApi: createHttpApi };
})();
