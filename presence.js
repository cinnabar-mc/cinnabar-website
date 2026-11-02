(() => {
  const activity = window.CINNABAR_ACTIVITY;

  /** Polls one aggregate independently, keeping failures from clearing the other count. */
  function pollCount(id, url, field, interval, format) {
    const label = document.getElementById(id);
    let timer;
    let pending = false;

    /** Refreshes the aggregate while attended and clears unavailable or invalid counts. */
    async function refresh() {
      if (!activity.active() || pending) return;
      pending = true;
      window.clearTimeout(timer);
      try {
        const response = await fetch(url, {
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Count unavailable');
        const body = await response.json();
        if (!Number.isSafeInteger(body?.[field]) || body[field] < 0) throw new Error('Invalid count');
        label.textContent = activity.active() ? format(body[field]) : '';
      } catch {
        label.textContent = '';
      } finally {
        pending = false;
        if (activity.active()) timer = window.setTimeout(refresh, interval);
      }
    }

    activity.subscribe(active => {
      window.clearTimeout(timer);
      label.textContent = '';
      if (active) void refresh();
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
