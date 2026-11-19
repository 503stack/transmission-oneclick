// Catches left-clicks on torrent links and hands them to the service worker
// instead of letting the browser download the file / open the magnet handler.
// With several download folders configured, a small menu at the cursor asks
// which one. Hold any modifier key (Cmd, Ctrl, Shift, Alt) to get the
// browser's normal behaviour for that click.
// parseFolders() comes from folders.js, loaded before this file.

// what counts as a torrent link (extra patterns come from the options page)
const BUILTIN_PATTERNS = [
  /^magnet:/i,
  /\.torrent([?#]|$)/i,
  /torrents\.php\?action=download/i,
  /[?&]info_hash=/i,
];

let extraPatterns = [];
let folders = [];

function compile(lines) {
  const out = [];
  for (const line of (lines || '').split('\n')) {
    const src = line.trim();
    if (!src || src.startsWith('#')) continue;
    try { out.push(new RegExp(src, 'i')); } catch { /* bad pattern: ignore */ }
  }
  return out;
}

chrome.storage.local.get({ patterns: '', folders: '' }, (s) => {
  extraPatterns = compile(s.patterns);
  folders = parseFolders(s.folders);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.patterns) extraPatterns = compile(changes.patterns.newValue);
  if (changes.folders) folders = parseFolders(changes.folders.newValue);
});

function isTorrentLink(url) {
  return BUILTIN_PATTERNS.some((r) => r.test(url)) || extraPatterns.some((r) => r.test(url));
}

// capture phase on window, so page scripts can't swallow the click first
window.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || !isTorrentLink(a.href)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const url = a.href;
  if (folders.length <= 1) {
    send(url, folders.length ? folders[0].dir : '', prefetch(url));
    return;
  }
  // start fetching the .torrent while the user picks a folder
  const pending = prefetch(url);
  showFolderMenu(e.clientX, e.clientY, (dir) => send(url, dir, pending));
}, true);

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// Fetch .torrent files from the page itself: same-origin requests always carry
// the site's login cookies, which the service worker's requests may not (Brave
// blocks third-party cookies). Resolves to null for magnets, cross-origin
// links, or anything that fails here; the service worker handles those.
async function prefetch(url) {
  if (/^magnet:/i.test(url)) return null;
  try {
    if (new URL(url).origin !== location.origin) return null;
    const res = await fetch(url, { credentials: 'include' });
    const buf = res.ok ? await res.arrayBuffer() : null;
    // a torrent file is a bencoded dictionary, so it starts with "d"
    return buf && new Uint8Array(buf)[0] === 0x64 ? toBase64(buf) : null;
  } catch {
    return null;
  }
}

async function send(url, dir, pending) {
  const metainfo = await pending;
  chrome.runtime.sendMessage({ type: 'add', url, dir, metainfo });
}

// ---- folder menu ------------------------------------------------------------

let closeMenu = null;

function showFolderMenu(x, y, onPick) {
  if (closeMenu) closeMenu();

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .menu { position: fixed; min-width: 180px; max-width: 360px; padding: 4px 0;
        background: #fff; color: #222; border: 1px solid rgba(0,0,0,.18); border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,.22); font: 13px/1.3 system-ui, sans-serif; }
      .title { padding: 4px 12px 6px; color: #777; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
      button { display: block; width: 100%; padding: 6px 12px; border: 0; background: none;
        color: inherit; font: inherit; text-align: left; cursor: pointer; }
      button:hover, button:focus { background: #c62828; color: #fff; outline: none; }
      .dir { display: block; font-size: 11px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (prefers-color-scheme: dark) {
        .menu { background: #2b2b2b; color: #eee; border-color: rgba(255,255,255,.15); }
        .title { color: #aaa; }
      }
    </style>
    <div class="menu" role="menu"><div class="title">Send to Transmission</div></div>`;
  const menu = root.querySelector('.menu');

  folders.forEach((f, i) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = `${i < 9 ? `${i + 1}. ` : ''}${f.label}`;
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = f.dir;
    b.append(label, dir);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); close(); onPick(f.dir); });
    menu.append(b);
  });

  const onDown = (ev) => { if (!ev.composedPath().includes(host)) close(); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    const n = Number(ev.key);
    if (n >= 1 && n <= Math.min(9, folders.length)) {   // number keys pick a folder
      ev.preventDefault(); close(); onPick(folders[n - 1].dir);
    }
  };
  function close() {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    host.remove();
    closeMenu = null;
  }
  closeMenu = close;
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);

  document.documentElement.append(host);
  // place at the cursor, kept inside the viewport
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  menu.querySelector('button').focus({ preventScroll: true });
}
