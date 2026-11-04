(() => {
  const label = document.getElementById('download-count');
  const config = window.CINNABAR_DOWNLOADS;
  const activity = window.CINNABAR_ACTIVITY;
  let timer;
  let controller;
  let sequence = 0;

  /** Shows verified package downloads, hiding unavailable totals and pausing in unattended tabs. */
  async function refresh() {
    const request = ++sequence;
    window.clearTimeout(timer);
    controller?.abort();
    if (!activity.active()) return;
    controller = new AbortController();
    try {
      const response = await fetch(config.download_count_url, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error('Download count unavailable');
      const body = await response.json();
      if (!Number.isSafeInteger(body?.downloads) || body.downloads < 0) throw new Error('Invalid download count');
      if (request !== sequence) return;
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
      if (request === sequence) label.replaceChildren();
    } finally {
      if (request === sequence && activity.active()) timer = window.setTimeout(refresh, 900_000);
    }
  }

  activity.subscribe(() => {
    label.replaceChildren();
    void refresh();
  });
  void refresh();
})();
