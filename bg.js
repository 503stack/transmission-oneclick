// Service worker: talks to the Transmission RPC and adds torrents.
importScripts('folders.js');   // parseFolders()

const DEFAULTS = {
  rpcUrl: '',
  user: '',
  pass: '',
  folders: '',
  paused: false,
  patterns: '',
};

const settings = () => chrome.storage.local.get(DEFAULTS);

// Transmission's CSRF token: any request without it gets a 409 carrying a
// fresh one, so remember it and retry once
let sessionId = '';

class NotConfigured extends Error {}

async function rpc(method, args = {}) {
  const s = await settings();
  if (!s.rpcUrl) throw new NotConfigured('Set the Transmission RPC URL in the extension options');
  const headers = { 'Content-Type': 'application/json' };
  if (s.user || s.pass) headers.Authorization = 'Basic ' + btoa(`${s.user}:${s.pass}`);
  const body = JSON.stringify({ method, arguments: args });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (sessionId) headers['X-Transmission-Session-Id'] = sessionId;
    const res = await fetch(s.rpcUrl, { method: 'POST', headers, body, credentials: 'omit' });
    if (res.status === 409) {
      sessionId = res.headers.get('X-Transmission-Session-Id') || '';
      continue;
    }
    if (res.status === 401) throw new Error('Transmission rejected the username/password');
    if (!res.ok) throw new Error(`Transmission RPC returned HTTP ${res.status}`);
    const json = await res.json();
    if (json.result !== 'success') throw new Error(json.result);
    return json.arguments;
  }
  throw new Error('Transmission kept refusing the session id');
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// .torrent file content, fetched with the browser's cookies for that site
// (private trackers need the login); null if that didn't produce a torrent
async function fetchTorrent(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // a torrent file is a bencoded dictionary, so it starts with "d"
    return new Uint8Array(buf)[0] === 0x64 ? toBase64(buf) : null;
  } catch {
    return null;
  }
}

// Magnets are passed through as-is. For .torrent links the file content is
// sent (from the content script if it could fetch it, else fetched here); if
// neither worked, Transmission is given the URL to download itself, which
// works for public sites but not ones that need a login.
// dir '' means Transmission's own default folder.
async function addTorrent(url, metainfo, dir) {
  const s = await settings();
  const args = { paused: !!s.paused };
  if (dir) args['download-dir'] = dir;

  if (/^magnet:/i.test(url)) {
    args.filename = url;
  } else {
    metainfo = metainfo || await fetchTorrent(url);
    if (metainfo) args.metainfo = metainfo;
    else args.filename = url;
  }

  const out = await rpc('torrent-add', args);
  if (out['torrent-added']) return { name: out['torrent-added'].name, duplicate: false };
  if (out['torrent-duplicate']) return { name: out['torrent-duplicate'].name, duplicate: true };
  return { name: url, duplicate: false };
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: message || '',
  });
}

async function handleAdd(url, metainfo, dir) {
  try {
    const { name, duplicate } = await addTorrent(url, metainfo, dir);
    if (duplicate) notify('Already in Transmission', name);
    else notify('Added to Transmission', dir ? `${name}\n→ ${dir}` : name);
  } catch (err) {
    notify('Could not add torrent', String(err.message || err));
    if (err instanceof NotConfigured) chrome.runtime.openOptionsPage();
  }
}

// options page "Test connection": version, default folder, and whether each
// configured folder exists on the Transmission host (free-space fails if not)
async function testConnection() {
  try {
    const a = await rpc('session-get', { fields: ['version', 'download-dir'] });
    const folders = [];
    for (const f of parseFolders((await settings()).folders)) {
      try {
        await rpc('free-space', { path: f.dir });
        folders.push({ dir: f.dir, ok: true });
      } catch (e) {
        folders.push({ dir: f.dir, ok: false, error: String(e.message || e) });
      }
    }
    return { ok: true, version: a.version, downloadDir: a['download-dir'], folders };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'add' && typeof msg.url === 'string') {
    handleAdd(msg.url, typeof msg.metainfo === 'string' ? msg.metainfo : null,
      typeof msg.dir === 'string' ? msg.dir : '');
  }
  if (msg && msg.type === 'test') {
    testConnection().then(sendResponse);
    return true;   // keep the channel open for the async answer
  }
  return false;
});

// Right-click fallback for links the patterns don't recognise: one entry, or
// a submenu with one entry per folder ("dir:<index>") when there are several.
async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const folders = parseFolders((await settings()).folders);
  chrome.contextMenus.create({ id: 'send', title: 'Send to Transmission', contexts: ['link'] });
  if (folders.length > 1) {
    folders.forEach((f, i) => chrome.contextMenus.create({
      id: `dir:${i}`, parentId: 'send', title: f.label, contexts: ['link'],
    }));
  }
}
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await buildMenus();
  // first install: nothing works until the RPC URL is set
  if (reason === 'install' && !(await settings()).rpcUrl) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.folders) buildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (!info.linkUrl) return;
  const folders = parseFolders((await settings()).folders);
  const id = String(info.menuItemId);
  if (id === 'send') handleAdd(info.linkUrl, null, folders.length ? folders[0].dir : '');
  else if (id.startsWith('dir:')) {
    const f = folders[Number(id.slice(4))];
    if (f) handleAdd(info.linkUrl, null, f.dir);
  }
});

// toolbar button opens Transmission's web UI (or the options, if not set up)
chrome.action.onClicked.addListener(async () => {
  const s = await settings();
  if (!s.rpcUrl) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: s.rpcUrl.replace(/\/rpc\/?$/, '/web/') });
});
