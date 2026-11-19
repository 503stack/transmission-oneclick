// Shared by the content script, service worker and options page.
// Download folders are one per line, either "/path" or "Label = /path".
// Blank lines and lines starting with # are ignored. The first folder is the
// default; an empty list means Transmission's own default folder.
function parseFolders(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    const dir = (eq >= 0 ? s.slice(eq + 1) : s).trim();
    if (!dir) continue;
    const label = (eq >= 0 ? s.slice(0, eq).trim() : '') || dir.replace(/\/+$/, '').split('/').pop() || dir;
    out.push({ label, dir });
  }
  return out;
}
