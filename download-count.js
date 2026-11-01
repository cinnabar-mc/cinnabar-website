(() => {
  const label = document.getElementById('download-count');
  const config = window.CINNABAR_DOWNLOADS;
  let timer;
  let pending = false;

  /** Shows verified package downloads, hiding unavailable totals and pausing in background tabs. */
  async function refresh() {
    if (document.hidden || pending) return;
    pending = true;
    window.clearTimeout(timer);
    try {
      const response = await fetch(config.download_count_url, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Download count unavailable');
      const body = await response.json();
      if (!Number.isSafeInteger(body?.downloads) || body.downloads < 0) throw new Error('Invalid download count');
      if (document.hidden) return;
      const link = document.createElement('a');
      link.href = config.release_url;
      link.title = 'Installer and update-package downloads, including repeat downloads';
      const number = document.createElement('strong');
      number.textContent = body.downloads.toLocaleString();
      link.append(number, body.downloads === 1 ? ' download on GitHub' : ' downloads on GitHub');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 20 20');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M8 2h4v7h4l-6 6-6-6h4zM3 15h3v2h8v-2h3v5H3z');
      icon.append(path);
      label.replaceChildren(icon, link);
    } catch {
      label.replaceChildren();
    } finally {
      pending = false;
      if (!document.hidden) timer = window.setTimeout(refresh, 300_000);
    }
  }

  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(timer);
    label.replaceChildren();
    if (!document.hidden) void refresh();
  });
  void refresh();
})();
