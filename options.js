// parseFolders() comes from folders.js
const DEFAULTS = {
  rpcUrl: '',
  user: '',
  pass: '',
  folders: '',
  paused: false,
  patterns: '',
};

const $ = (id) => document.getElementById(id);
const status = (text, cls) => { $('status').textContent = text; $('status').className = cls || ''; };

function read() {
  return {
    rpcUrl: $('rpcUrl').value.trim(),
    user: $('user').value,
    pass: $('pass').value,
    folders: $('folders').value,
    paused: $('paused').checked,
    patterns: $('patterns').value,
  };
}

function badPatterns(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).filter((l) => {
    try { new RegExp(l); return false; } catch { return true; }
  });
}

chrome.storage.local.get(DEFAULTS, (s) => {
  for (const k of ['rpcUrl', 'user', 'pass', 'folders', 'patterns']) $(k).value = s[k];
  $('paused').checked = s.paused;
});

async function save() {
  const s = read();
  const bad = badPatterns(s.patterns);
  if (bad.length) { status(`Invalid pattern: ${bad[0]}`, 'err'); return false; }
  const relative = parseFolders(s.folders).find((f) => !f.dir.startsWith('/'));
  if (relative) { status(`Folder must be an absolute path: ${relative.dir}`, 'err'); return false; }
  await chrome.storage.local.set(s);
  return true;
}

$('save').addEventListener('click', async () => {
  if (await save()) status('Saved', 'ok');
});

$('test').addEventListener('click', async () => {
  if (!(await save())) return;
  status('Connecting…');
  const r = await chrome.runtime.sendMessage({ type: 'test' });
  if (!r || !r.ok) { status(r ? r.error : 'No answer from the extension', 'err'); return; }
  const lines = [`Connected: Transmission ${r.version} (its default folder: ${r.downloadDir})`];
  const missing = (r.folders || []).filter((f) => !f.ok);
  for (const f of r.folders || []) lines.push(`${f.ok ? '✓' : '✗'} ${f.dir}${f.ok ? '' : ` — ${f.error}`}`);
  status(lines.join('\n'), missing.length ? 'err' : 'ok');
});
