(() => {
  /** Without input for this long, a visible tab counts as unattended and stops polling the API. */
  const IDLE_MS = 600_000;
  const listeners = [];
  let lastInput = performance.now();
  let idle = false;
  let timer;

  const active = () => !document.hidden && !idle;
  const notify = () => listeners.forEach(callback => callback(active()));

  /** Marks the page unattended once the newest input is older than the idle limit. */
  function check() {
    const elapsed = performance.now() - lastInput;
    if (elapsed < IDLE_MS) {
      timer = window.setTimeout(check, IDLE_MS - elapsed);
      return;
    }
    idle = true;
    notify();
  }

  /** Records attention, resuming polling at once if the page had gone idle. */
  function attend() {
    lastInput = performance.now();
    if (!idle || document.hidden) return;
    idle = false;
    timer = window.setTimeout(check, IDLE_MS);
    notify();
  }

  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focus']) {
    window.addEventListener(name, attend, {capture: true, passive: true});
  }
  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(timer);
    if (!document.hidden) {
      lastInput = performance.now();
      idle = false;
      timer = window.setTimeout(check, IDLE_MS);
    }
    notify();
  });
  if (!document.hidden) timer = window.setTimeout(check, IDLE_MS);

  /** Shared by every poller: active means visible and touched within the idle limit. */
  window.CINNABAR_ACTIVITY = {active, subscribe: callback => { listeners.push(callback); }};
})();
