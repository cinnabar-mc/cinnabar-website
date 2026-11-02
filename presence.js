(() => {
  const activity = window.CINNABAR_ACTIVITY;

  /** Polls one aggregate independently, keeping failures from clearing the other count. */
  function pollCount(id, url, field, interval, format) {
    const label = document.getElementById(id);
    let timer;
    let controller;
    let sequence = 0;

    /** Refreshes the aggregate while attended; a newer call cancels and supersedes any request in flight. */
    async function refresh() {
      const request = ++sequence;
      window.clearTimeout(timer);
      controller?.abort();
      if (!activity.active()) return;
      controller = new AbortController();
      try {
        const response = await fetch(url, {
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) throw new Error('Count unavailable');
        const body = await response.json();
        if (!Number.isSafeInteger(body?.[field]) || body[field] < 0) throw new Error('Invalid count');
        if (request === sequence) label.textContent = format(body[field]);
      } catch {
        if (request === sequence) label.textContent = '';
      } finally {
        if (request === sequence && activity.active()) timer = window.setTimeout(refresh, interval);
      }
    }

    activity.subscribe(() => {
      label.textContent = '';
      void refresh();
    });
    void refresh();
  }

  pollCount('online-count', window.CINNABAR_DOWNLOADS.online_count_url, 'online', 60_000, count => count === 1
    ? '1 person is using Cinnabar right now'
    : `${count.toLocaleString()} people are using Cinnabar right now`);
  pollCount('unique-count', window.CINNABAR_DOWNLOADS.unique_count_url, 'unique', 600_000, count => count === 1
    ? '1 unique user'
    : `${count.toLocaleString()} unique users`);
})();
