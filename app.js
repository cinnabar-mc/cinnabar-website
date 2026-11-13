function detectPlatform(userAgent, platform, touchPoints) {
  if (/Android/i.test(platform + ' ' + userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && touchPoints > 1)) return 'mobile';
  if (/Windows|Win/i.test(platform + ' ' + userAgent)) return 'windows';
  if (/CrOS/i.test(userAgent)) return 'unsupported';
  if (/Mac/i.test(platform + ' ' + userAgent)) return 'macos';
  if (/Linux/i.test(platform + ' ' + userAgent)) return 'linux';
  return 'unsupported';
}

const downloadButton = document.getElementById('download');
if (downloadButton.dataset?.modDownload) {
  setupDownloadChannel(channel => {
    downloadButton.href = `${downloadButton.dataset.modDownload}?channel=${channel}`;
  });
} else {
  setupClientDownload(downloadButton);
}

/**
 * Shares channel selection, its checked state and keyboard navigation across download pages.
 * Choosing a channel only selects it; the download key is the one control that downloads.
 */
function setupDownloadChannel(applyChannel) {
  const split = document.getElementById('download-split');
  const toggle = document.getElementById('channel-toggle');
  const menu = document.getElementById('channel-menu');
  const options = [document.getElementById('channel-beta'), document.getElementById('channel-nightly')];
  const notes = Array.from(document.querySelectorAll('[data-channel-note]'));
  let channel = 'beta';

  /** Applies a channel to the download, the menu's checked row and every line that names Nightly. */
  function select(selected) {
    channel = selected;
    applyChannel(channel);
    options.forEach(option => option.setAttribute('aria-checked', String(option.dataset.channel === channel)));
    notes.forEach(note => { note.hidden = channel !== 'nightly'; });
  }
  select(channel);

  function setMenu(open, focusIndex) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) options[focusIndex ?? options.findIndex(option => option.dataset.channel === channel)].focus();
  }
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  toggle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setMenu(true, event.key === 'ArrowUp' ? options.length - 1 : 0);
  });
  menu.addEventListener('keydown', event => {
    const index = options.indexOf(event.target);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(event.target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false);
      toggle.focus();
    }
  });
  options.forEach(option => option.addEventListener('click', () => choose(option)));
  document.addEventListener('click', event => {
    if (!menu.hidden && !split.contains(event.target)) setMenu(false);
  });
  // Tabbing out of the keys closes the menu, so it never stays open over the page behind it.
  split.addEventListener('focusout', event => {
    if (!menu.hidden && event.relatedTarget && !split.contains(event.relatedTarget)) setMenu(false);
  });

  /** Selects a channel and hands focus back to the channel key, which now names the choice. */
  function choose(option) {
    select(option.dataset.channel);
    setMenu(false);
    toggle.focus();
  }
}

// Keep platform detection and installer dialogs specific to the client download.
function setupClientDownload(button) {
  const config = window.CINNABAR_DOWNLOADS;
  const assets = {...config.assets, ...config.manual_assets};
  const platform = detectPlatform(navigator.userAgent, navigator.userAgentData?.platform || navigator.platform, navigator.maxTouchPoints);
  const labels = {windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android'};
  const dialog = document.getElementById('install-dialog');
  // Platforms whose download starts at once: the dialog then says what to do with the file.
  const direct = {windows: ['windows', 'x86_64'], android: ['android', 'arm64']}[platform];
  const sections = {linux: 'linux-install', macos: 'macos-install', windows: 'windows-install', android: 'android-install'};
  const titles = {linux: 'Install on Linux', macos: 'Download for macOS', windows: 'Install on Windows', android: 'Install on Android'};
  document.getElementById('download-label').textContent = labels[platform] ? `Download for ${labels[platform]}` : 'Downloads';
  // Without this script the key is a plain link to the platform list. With it, the key acts as a button.
  button.setAttribute('role', 'button');
  if (platform === 'mobile') {
    document.getElementById('options-intro').textContent = 'Cinnabar is not available for iPhone or iPad. Choose a platform to download it for another device.';
  }
  let channel = 'beta';
  const base = () => channel === 'nightly' ? config.nightly_base : config.download_base;
  const installCommand = () => channel === 'nightly' ? config.nightly_install_command : config.install_command;

  function applyChannel() {
    document.getElementById('install-command').value = installCommand();
    document.querySelectorAll('[data-release-asset]').forEach(link => {
      const [os, arch] = link.dataset.releaseAsset.split('/');
      link.href = base() + assets[os][arch];
    });
  }
  setupDownloadChannel(selected => {
    channel = selected;
    applyChannel();
  });

  button.addEventListener('click', event => {
    event.preventDefault();
    startDownload();
  });
  button.addEventListener('keydown', event => {
    if (event.key !== ' ') return;
    event.preventDefault();
    startDownload();
  });

  /** Starts the download where one file fits the device, then opens the dialog with that platform's steps. */
  function startDownload() {
    for (const [name, id] of Object.entries(sections)) document.getElementById(id).hidden = platform !== name;
    document.getElementById('desktop-install').hidden = platform in sections;
    document.getElementById('install-title').textContent = titles[platform] || 'Choose your platform';
    document.querySelectorAll('[data-copy]').forEach(copyButton => { copyButton.textContent = 'Copy'; });
    document.querySelectorAll('[data-copy-status]').forEach(status => { status.textContent = ''; });
    if (direct) {
      const file = assets[direct[0]][direct[1]];
      document.querySelectorAll('[data-download-file]').forEach(name => { name.textContent = file; });
      window.location.assign(base() + file);
    }
    dialog.showModal();
  }
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });

  /** Copies a command and confirms it, or selects the command for manual copying when the clipboard is unavailable. */
  function copyKey(id, text, sourceId, statusId, done) {
    document.getElementById(id).addEventListener('click', async event => {
      const copyButton = event.currentTarget;
      const status = document.getElementById(statusId);
      try {
        await navigator.clipboard.writeText(text());
        copyButton.textContent = 'Copied';
        status.textContent = done;
      } catch {
        const source = document.getElementById(sourceId);
        if (source.select) {
          source.focus();
          source.select();
        } else {
          window.getSelection?.()?.selectAllChildren(source);
        }
        status.textContent = 'Select and copy the command above.';
      }
    });
  }
  copyKey('copy-command', installCommand, 'install-command', 'copy-status', 'Install command copied.');
  copyKey('copy-first-open', () => document.getElementById('first-open-command').textContent, 'first-open-command', 'first-open-status', 'Command copied.');
}
