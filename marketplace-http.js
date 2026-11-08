(function () {
  "use strict";
  const content = typeof module !== "undefined" ? require("./marketplace-content.js") : window.CinnabarContent;

  /**
   * A client for the live marketplace API. It sends the session cookie the API set after Google sign-in,
   * and repeats the CSRF token from `GET /me` on every write. Uploads go as multipart, so the API reads the
   * component's grants and hash itself.
   */
  function createHttpApi(base, fetchImpl, location) {
    let csrf = "";
    let identityGeneration = 0;
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
    const api = {
      backend: "http",
      /** Answers `{status, body}` like the mock; network failures reject. */
      request: async function (method, path, body) {
        if (path === '/auth/signout') identityGeneration++;
        const identity = identityGeneration;
        const form = typeof FormData !== "undefined" && body instanceof FormData;
        const headers = { Accept: "application/json" };
        if (body && !form) headers["Content-Type"] = "application/json";
        if (method !== "GET") headers["X-Cinnabar-CSRF"] = csrf;
        const response = await fetchImpl(base + path, {
          method: method, credentials: "include", referrerPolicy: "strict-origin", headers: headers,
          body: form ? body : body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(form ? 120000 : 10000),
        });
        const data = response.status === 204 ? null : await response.json().catch(function () { return { error: "The marketplace didn't answer properly." }; });
        const sessionResponse = path === '/me' || path === '/me/username';
        if (sessionResponse && response.status === 200 && identity === identityGeneration) csrf = data && typeof data.csrf === "string" ? data.csrf : '';
        if (path === '/auth/signout' && (response.status === 200 || response.status === 204)) csrf = '';
        const privateView = path === '/me/mods' || path.startsWith('/staff/') || path === '/submissions';
        const bodyData = response.status === 200 && !sessionResponse
          ? (Array.isArray(data) ? data.map(item => release(item, privateView)) : release(data, privateView)) : data;
        return { status: response.status, body: bodyData };
      },
      /** Leaves for Google sign-in, returning to this exact page. */
      signIn: function () {
        location.assign(base + "/auth/google/start?return_to=" + encodeURIComponent(location.href));
      },
      /** Link to an authenticated attachment download of the exact submitted release. */
      fileUrl: function (id) { return /^[0-9]{1,12}$/.test(String(id)) ? base + '/staff/versions/' + id + '/file' : null; },
      /** Upload listing text and the exact component; its embedded icon travels in the file. */
      submit: async function (fields, file) {
        const fail = message => ({ status: 422, body: { error: message + ' Your draft has been retained.' } });
        if (String(fields.description || "").length > 40000) return fail('Descriptions can have up to 40,000 characters.');
        if (!file || file.size > 16 * 1024 * 1024) return fail('Choose a component up to 16 MiB.');
        const form = new FormData();
        const listing = { ...fields }; delete listing.gallery; delete listing.images; delete listing.icon;
        form.set("listing", JSON.stringify(listing));
        form.set("file", file);
        return api.request("POST", "/submissions", form);
      },
    };
    return api;
  }

  if (typeof module !== "undefined") module.exports = { createHttpApi: createHttpApi };
  if (typeof window !== "undefined") window.CinnabarMarketHttp = { createHttpApi: createHttpApi };
})();
