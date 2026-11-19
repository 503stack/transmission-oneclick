# Transmission One-Click

Minimal Manifest V3 extension for Brave/Chrome: a normal left-click on a
magnet or `.torrent` link sends it straight to Transmission, with a
notification. It replaces the one-click part of Remote Transmission ++, which
is Manifest V2 and no longer runs in Chromium-based browsers.

- **Click** a torrent link to send it to Transmission. Hold Cmd, Ctrl, Shift or
  Alt while clicking to get the browser's normal behaviour instead.
- **Right-click → Send to Transmission** works on any link, for sites whose
  download links the patterns don't recognise. To make those one-click too,
  add a regex under *Extra link patterns* in the options.
- **Toolbar button** opens Transmission's web UI.

## Download folders

List them in the options, one per line, as `/path` or `Label = /path`:

```
Downloads = /downloads
Audiobooks = /downloads/audiobooks
```

- None or one folder: a click sends the torrent there right away (none means
  Transmission's own default folder).
- Two or more: a click opens a small menu at the cursor. Pick a folder with
  the mouse, its number key (1–9) or Enter; Esc or clicking elsewhere cancels.
  The `.torrent` is already being fetched while you choose.
- The right-click entry gets a submenu with the same folders.
- **Test connection** checks that every folder exists on the Transmission host.

`.torrent` files are fetched from the page itself where possible, so private
trackers get your login cookies, then from the extension, and as a last resort
Transmission is given the URL to fetch itself. Magnets are passed through.

## Install (unpacked)

1. Open `brave://extensions` and turn on **Developer mode** (top right).
2. **Load unpacked**, and pick this folder.
3. The options open on first install (or via **Details → Extension options**).
   Enter Transmission's RPC URL, e.g. `http://192.168.1.10:9091/transmission/rpc`
   or `https://transmission.example.org/transmission/rpc` behind a reverse
   proxy, plus username/password if RPC authentication is on, and click
   **Test connection**.

After editing the code, press the reload icon on its card in
`brave://extensions`. Unpacked extensions stay installed across restarts.

## Troubleshooting

- **HTTP 421** from Test connection: Transmission's host whitelist doesn't
  know the hostname in your RPC URL. Add it to `rpc-host-whitelist` in
  `settings.json` (stop the daemon before editing), or use the IP address.
- **HTTP 403**: `rpc-whitelist` doesn't allow your computer's IP address.
- **"invalid or corrupt torrent file"** on a private tracker: log in to
  the site in the browser first; the `.torrent` is downloaded with your
  browser session.

## License

[MIT](LICENSE)
