// Notch for Windows — main process
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, nativeTheme, globalShortcut, net, shell } = require('electron');
let autoUpdater = null; try { autoUpdater = require('electron-updater').autoUpdater; } catch {}
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 47811;
const WIN_W = 900;
const WIN_H = 460;

let win = null;
let tray = null;
let mediaProc = null;
let settings = null;

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  theme: 'auto',                 // auto | light | dark
  city: { name: 'الفلوجة', lat: 33.3496, lon: 43.7836 },
  widgets: ['music', 'weather', 'date', 'timer'],
  hidden: [],
  timerMinutes: 25,
  showLyrics: true,
  peekApps: true,
  mirrorNotifs: true,
  notifMute: [],
  firstRun: true,
  autoStart: true,
  blur: false,
  pillColor: '#050506',
  pillOpacity: 1,
};
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch {}
}
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

// ---------------------------------------------------------------- window
function createWindow() {
  const d = screen.getPrimaryDisplay();
  const x = Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2);
  const y = d.bounds.y;
  win = new BrowserWindow({
    x, y, width: WIN_W, height: WIN_H,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  // keep on top even if something else grabs top-most
  setInterval(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver'); }, 5000);
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
}
function reposition() {
  if (!win) return;
  const d = screen.getPrimaryDisplay();
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2), y: d.bounds.y, width: WIN_W, height: WIN_H });
}

let interactive = false;
// ---------------------------------------------------------------- glass (acrylic) backdrop
let blurWin = null;
function ensureBlur() {
  if (!settings.blur || process.platform !== 'win32') { if (blurWin && !blurWin.isDestroyed()) blurWin.destroy(); blurWin = null; return; }
  if (blurWin && !blurWin.isDestroyed()) return;
  blurWin = new BrowserWindow({
    width: 200, height: 32, x: 0, y: 0, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, show: false, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic', webPreferences: { contextIsolation: true },
  });
  try { blurWin.setBackgroundMaterial('acrylic'); } catch {}
  blurWin.setIgnoreMouseEvents(true);
  blurWin.setAlwaysOnTop(true, 'pop-up-menu');
  blurWin.loadURL('data:text/html,<html style="background:transparent"></html>');
  blurWin.on('closed', () => { blurWin = null; });
}
function roundedBottomShape(w, h, r) {
  const rects = [{ x: 0, y: 0, width: w, height: Math.max(0, h - r) }];
  for (let i = 0; i < r; i++) {
    const dy = i + 0.5, inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
    rects.push({ x: inset, y: h - i - 1, width: Math.max(0, w - 2 * inset), height: 1 });
  }
  return rects;
}
let blurShown = false;
ipcMain.on('island:rect', (_e, rc) => {
  if (!settings.blur) return;
  ensureBlur();
  if (!blurWin || !win) return;
  if (!rc || !rc.visible || rc.w < 10) { if (blurShown) { blurWin.hide(); blurShown = false; } return; }
  const b = win.getBounds();
  const w = Math.round(rc.w), h = Math.round(rc.h), r = Math.round(rc.r || 0);
  blurWin.setBounds({ x: Math.round(b.x + rc.x), y: Math.round(b.y + rc.y), width: w, height: h });
  try { blurWin.setShape(roundedBottomShape(w, h, r)); } catch {}
  if (!blurShown) { blurWin.showInactive(); blurShown = true; win.moveTop(); }
});

ipcMain.on('mouse', (_e, v) => {
  if (!win) return;
  interactive = !!v;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});
// safety net: if the cursor leaves the window fast, tell the renderer
setInterval(() => {
  if (!win || win.isDestroyed() || !interactive) return;
  const p = screen.getCursorScreenPoint(), b = win.getBounds();
  if (p.x < b.x || p.x >= b.x + b.width || p.y < b.y || p.y >= b.y + b.height) send('mouse-out');
}, 250);

// ---------------------------------------------------------------- theme
function effectiveTheme() {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}
nativeTheme.on('updated', () => send('theme', effectiveTheme()));

// ---------------------------------------------------------------- media (PowerShell helper, Windows only)
let lastTrackKey = '';
function startMedia() {
  if (process.platform !== 'win32') return;
  let script = path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');
  mediaProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buf = '';
  mediaProc.stdout.setEncoding('utf8');
  mediaProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { handleMedia(JSON.parse(line)); } catch {}
    }
  });
  mediaProc.on('exit', () => { mediaProc = null; setTimeout(startMedia, 4000); });
}
// ---------------------------------------------------------------- notification mirror
let notifProc = null;
function startNotifs() {
  if (process.platform !== 'win32' || notifProc) return;
  const script = path.join(__dirname, 'notify.ps1').replace('app.asar', 'app.asar.unpacked');
  notifProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buf = '';
  notifProc.stdout.setEncoding('utf8');
  notifProc.stdout.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (m.type === 'notif' && settings.mirrorNotifs && !(settings.notifMute || []).includes(m.appId)) send('notif', m);
        if (m.type === 'notif-status') send('notif-status', m);
      } catch {}
    }
  });
  notifProc.on('exit', () => { notifProc = null; if (settings.mirrorNotifs) setTimeout(startNotifs, 5000); });
}
ipcMain.on('notif:open', (_e, n) => {
  if (n && n.url && /^[a-z][a-z0-9+.-]{1,30}:/i.test(n.url) && !/^(file|javascript|vbscript|data):/i.test(n.url)) return shell.openExternal(n.url);
  if (n && n.appId && notifProc) try { notifProc.stdin.write('activate ' + String(n.appId).replace(/[\r\n]/g, '') + '\n'); } catch {}
});
ipcMain.on('notif:mute', (_e, appId) => { settings.notifMute = [...new Set([...(settings.notifMute || []), appId])]; saveSettings(); });

function mediaCommand(cmd) { if (mediaProc) try { mediaProc.stdin.write(cmd + '\n'); } catch {} }
ipcMain.on('media', (_e, cmd) => mediaCommand(cmd));

function handleMedia(msg) {
  if (msg.type === 'media') {
    send('media', msg);
    const key = msg.title ? `${msg.artist}|${msg.title}` : '';
    if (key && key !== lastTrackKey) { lastTrackKey = key; fetchLyrics(msg); }
    if (!key) lastTrackKey = '';
  } else if (msg.type === 'app') {
    if (settings.peekApps) send('peek', { kind: 'app', text: msg.name, sub: 'فُتح' });
  } else if (msg.type === 'art') {
    send('art', msg);
  }
}

// ---------------------------------------------------------------- lyrics (lrclib.net)
function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[\(\[][^\)\]]*(official|video|lyrics?|audio|visuali[sz]er|clip|HD|4K|مترجم|كلمات|فيديو)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+-\s+topic$/i, '')
    .trim();
}
async function getJSON(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'NotchForWindows/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function parseLRC(lrc) {
  const out = [];
  for (const line of String(lrc).split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: (+m[1]) * 60 + (+m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function fetchLyrics(m) {
  const key = lastTrackKey;
  let title = cleanTitle(m.title), artist = (m.artist || '').replace(/\s+-\s+topic$/i, '').trim();
  if (title.includes(' - ')) { const [a, b] = title.split(' - '); if (!artist || m.source === 'browser') { artist = a.trim(); title = cleanTitle(b); } }
  send('lyrics', { key, lines: [], status: 'loading' });
  try {
    let found = null;
    try {
      const q = new URLSearchParams({ artist_name: artist, track_name: title });
      if (m.duration > 0) q.set('duration', Math.round(m.duration));
      found = await getJSON('https://lrclib.net/api/get?' + q);
    } catch {}
    if (!found || (!found.syncedLyrics && !found.plainLyrics)) {
      const res = await getJSON('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${artist} ${title}`.trim() }));
      found = (res || []).find(x => x.syncedLyrics) || (res || [])[0];
    }
    if (key !== lastTrackKey) return;
    if (found && found.syncedLyrics) send('lyrics', { key, lines: parseLRC(found.syncedLyrics), status: 'synced' });
    else if (found && found.plainLyrics) send('lyrics', { key, lines: found.plainLyrics.split(/\r?\n/).filter(Boolean).map(text => ({ t: -1, text })), status: 'plain' });
    else send('lyrics', { key, lines: [], status: 'none' });
  } catch { if (key === lastTrackKey) send('lyrics', { key, lines: [], status: 'none' }); }
}

// ---------------------------------------------------------------- weather (open-meteo)
let weatherTimer = null;
async function fetchWeather() {
  const c = settings.city;
  try {
    const q = new URLSearchParams({ latitude: c.lat, longitude: c.lon, current: 'temperature_2m,weather_code,is_day', daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: 1 });
    const j = await getJSON('https://api.open-meteo.com/v1/forecast?' + q);
    send('weather', { city: c.name, temp: j.current.temperature_2m, code: j.current.weather_code, isDay: j.current.is_day, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0] });
  } catch { send('weather', { city: c.name, error: true }); }
}
function startWeather() { fetchWeather(); clearInterval(weatherTimer); weatherTimer = setInterval(fetchWeather, 15 * 60 * 1000); }
ipcMain.handle('city:search', async (_e, name) => {
  try {
    const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: 1, language: 'ar' }));
    const r = j.results && j.results[0];
    if (!r) return { ok: false };
    settings.city = { name: r.name, lat: r.latitude, lon: r.longitude }; saveSettings(); fetchWeather();
    return { ok: true, name: r.name, country: r.country };
  } catch { return { ok: false }; }
});

// ---------------------------------------------------------------- settings IPC
ipcMain.handle('settings:get', () => ({ ...settings, effectiveTheme: effectiveTheme(), hooksInstalled: hooksInstalled(), openAtLogin: isAutoStart() }));
ipcMain.on('settings:set', (_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if (patch.mirrorNotifs === true && !notifProc) startNotifs();
  if (patch.mirrorNotifs === false && notifProc) try { notifProc.kill(); } catch {}
  if ('theme' in patch) send('theme', effectiveTheme());
  if ('blur' in patch) { ensureBlur(); if (!settings.blur && blurWin) { blurWin.destroy(); blurWin = null; } blurShown = false; }
  buildTrayMenu();
});
ipcMain.handle('hooks:install', () => installHooks());
ipcMain.handle('hooks:remove', () => removeHooks());
const LOGIN = () => ({ path: process.execPath, args: ['--autostart'], name: 'Notch' });
function applyAutoStart() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try { app.setLoginItemSettings({ ...LOGIN(), openAtLogin: !!settings.autoStart, enabled: !!settings.autoStart }); } catch {}
}
function isAutoStart() { try { return app.isPackaged ? app.getLoginItemSettings(LOGIN()).openAtLogin : !!settings.autoStart; } catch { return !!settings.autoStart; } }
ipcMain.on('login:set', (_e, v) => { settings.autoStart = !!v; saveSettings(); applyAutoStart(); buildTrayMenu(); });

// ---------------------------------------------------------------- Claude Code bridge
const sessions = new Map(); // session_id -> { start, files:Set }
const pending = new Map();  // id -> { res, timer }
let pid = 0;

function describeTool(name, input = {}) {
  if (input.command) return String(input.command);
  if (input.file_path) return `${name} ${path.basename(input.file_path)}`;
  if (input.notebook_path) return `${name} ${path.basename(input.notebook_path)}`;
  if (input.url) return `${name} ${input.url}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  const s = JSON.stringify(input); return `${name} ${s.length > 60 ? s.slice(0, 60) + '…' : s}`;
}
function readBody(req) { return new Promise((ok) => { let b = ''; req.setEncoding('utf8'); req.on('data', c => b += c); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); }); }
function reply(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); }

function decide(id, behavior) {
  const p = pending.get(id); if (!p) return;
  pending.delete(id); clearTimeout(p.timer);
  const decision = behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'رُفض من شريط النوتش' };
  reply(p.res, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
  send('claude:resolved', { id, behavior });
  updateShortcuts();
}
ipcMain.on('claude:decide', (_e, { id, behavior }) => decide(id, behavior));

function updateShortcuts() {
  globalShortcut.unregister('CommandOrControl+Alt+Y'); globalShortcut.unregister('CommandOrControl+Alt+N');
  const first = [...pending.keys()][0];
  if (first === undefined) return;
  globalShortcut.register('CommandOrControl+Alt+Y', () => { const f = [...pending.keys()][0]; if (f !== undefined) decide(f, 'allow'); });
  globalShortcut.register('CommandOrControl+Alt+N', () => { const f = [...pending.keys()][0]; if (f !== undefined) decide(f, 'deny'); });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(200); res.end('notch ok'); return; }
    const body = await readBody(req);
    const sid = body.session_id || 'default';
    const project = body.cwd ? path.basename(body.cwd) : '';
    const s = sessions.get(sid) || { start: Date.now(), files: new Set() };
    sessions.set(sid, s);
    switch (req.url) {
      case '/hook/prompt':
        s.start = Date.now(); s.files = new Set();
        send('claude:working', { project });
        return reply(res);
      case '/hook/post-tool':
        if (body.tool_input && (body.tool_input.file_path || body.tool_input.notebook_path)) s.files.add(body.tool_input.file_path || body.tool_input.notebook_path);
        return reply(res);
      case '/hook/permission': {
        const id = ++pid;
        const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reply(res); send('claude:resolved', { id, behavior: 'timeout' }); updateShortcuts(); } }, 55000);
        pending.set(id, { res, timer });
        // user answered in the terminal / Claude cancelled -> connection closes before we reply
        res.on('close', () => { if (pending.has(id) && !res.writableEnded) { clearTimeout(timer); pending.delete(id); send('claude:resolved', { id, behavior: 'cancel' }); updateShortcuts(); } });
        send('claude:ask', { id, tool: body.tool_name, detail: describeTool(body.tool_name || '', body.tool_input || {}), project });
        updateShortcuts();
        return;
      }
      case '/hook/stop': {
        const secs = Math.max(1, Math.round((Date.now() - s.start) / 1000));
        send('claude:done', { secs, files: s.files.size, project });
        s.files = new Set();
        return reply(res);
      }
      default: return reply(res);
    }
  });
  server.on('error', () => {});
  server.listen(PORT, '127.0.0.1');
}

// hooks installer -> %USERPROFILE%\.claude\settings.json
const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_URL = `http://127.0.0.1:${PORT}`;
const HOOKS = {
  UserPromptSubmit: { path: '/hook/prompt', timeout: 5 },
  PostToolUse: { path: '/hook/post-tool', timeout: 5, matcher: 'Edit|Write|MultiEdit|NotebookEdit' },
  PermissionRequest: { path: '/hook/permission', timeout: 60, matcher: '*' },
  Stop: { path: '/hook/stop', timeout: 5 },
};
function readClaudeSettings() { try { return JSON.parse(fs.readFileSync(claudeSettingsPath(), 'utf8')); } catch { return {}; } }
function stripOurHooks(cfg) {
  if (!cfg.hooks) return cfg;
  for (const ev of Object.keys(cfg.hooks)) {
    cfg.hooks[ev] = (cfg.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !(h.url && h.url.startsWith(HOOK_URL))) })).filter(g => g.hooks.length);
    if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  return cfg;
}
function hooksInstalled() { return JSON.stringify(readClaudeSettings().hooks || {}).includes(HOOK_URL); }
function writeClaudeSettings(cfg) {
  const p = claudeSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) fs.copyFileSync(p, p + '.notch-backup');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}
function installHooks() {
  try {
    const cfg = stripOurHooks(readClaudeSettings());
    cfg.hooks = cfg.hooks || {};
    for (const [ev, h] of Object.entries(HOOKS)) {
      const group = { hooks: [{ type: 'http', url: HOOK_URL + h.path, timeout: h.timeout }] };
      if (h.matcher) group.matcher = h.matcher;
      (cfg.hooks[ev] = cfg.hooks[ev] || []).push(group);
    }
    writeClaudeSettings(cfg); buildTrayMenu();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function removeHooks() {
  try { writeClaudeSettings(stripOurHooks(readClaudeSettings())); buildTrayMenu(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---------------------------------------------------------------- PC care
let careWin = null;
function openCare(tab) {
  if (careWin && !careWin.isDestroyed()) { careWin.show(); careWin.focus(); if (tab) careWin.webContents.send('care:tab', tab); return; }
  careWin = new BrowserWindow({
    width: 1000, height: 680, minWidth: 820, minHeight: 560, show: false, title: 'العناية بالحاسوب',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f3f3f5', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'tray.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ddd' : '#333', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  careWin.loadFile(path.join(__dirname, 'care.html'), { query: { tab: tab || 'home' } });
  careWin.once('ready-to-show', () => careWin.show());
  careWin.on('closed', () => { careWin = null; });
}
ipcMain.on('care:open', (_e, tab) => openCare(tab));
ipcMain.handle('care:theme', () => effectiveTheme());

function runCare(action, arg = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, error: 'windows only' });
    const script = path.join(__dirname, 'care.ps1').replace('app.asar', 'app.asar.unpacked');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-Arg', JSON.stringify(arg)], { windowsHide: true });
    let out = ''; p.stdout.setEncoding('utf8'); p.stdout.on('data', d => out += d);
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 180000);
    p.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(out.replace(/^﻿/, ''))); } catch { resolve({ ok: false, error: 'bad output' }); } });
  });
}
ipcMain.handle('care:run', async (_e, action, arg) => {
  const r = await runCare(action, arg);
  if (action === 'boost' && r.ok) send('peek', { kind: 'boost', text: 'تم التسريع', sub: fmtBytes(r.ramFreed + r.tempFreed) });
  if (action === 'clean' && r.ok) send('peek', { kind: 'boost', text: 'تم التنظيف', sub: fmtBytes(r.freed) });
  return r;
});
function fmtBytes(b) { b = Math.max(0, b || 0); const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; }

// live system stats (cpu / ram / disk) — cheap, pure node
let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus(); let idle = 0, total = 0;
  now.forEach((c, i) => { const p = lastCpu[i] || c; for (const k in c.times) total += c.times[k] - p.times[k]; idle += c.times.idle - p.times.idle; });
  lastCpu = now; return total > 0 ? Math.round(100 - idle / total * 100) : 0;
}
ipcMain.handle('sys:stats', async () => {
  let disk = null;
  try { const root = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/'; const st = await fs.promises.statfs(root); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch {}
  return { cpu: cpuPercent(), ramTotal: os.totalmem(), ramFree: os.freemem(), disk, uptime: os.uptime() };
});
ipcMain.on('shell:open', (_e, url) => { if (/^(ms-settings:|windowsdefender:|https:\/\/)/.test(url)) shell.openExternal(url); });
ipcMain.on('shell:show', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); });
ipcMain.handle('shell:trash', async (_e, p) => { try { await shell.trashItem(p); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });

// ---------------------------------------------------------------- auto update (GitHub Releases)
let updateReady = false;
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => send('peek', { kind: 'update', text: 'يتم تنزيل تحديث', sub: 'v' + i.version }));
  autoUpdater.on('update-downloaded', (i) => { updateReady = true; buildTrayMenu(); send('update:ready', { version: i.version }); send('peek', { kind: 'update', text: 'التحديث جاهز', sub: 'v' + i.version, ms: 5000 }); });
  autoUpdater.on('error', () => {});
  checkUpdates(false);
  setInterval(() => checkUpdates(false), 4 * 60 * 60 * 1000);
}
function checkUpdates(manual) {
  if (!autoUpdater || !app.isPackaged) { if (manual) send('peek', { kind: 'update', text: 'التحديث متاح فقط في النسخة المثبّتة', sub: '' }); return; }
  autoUpdater.checkForUpdates().then(r => {
    if (manual && (!r || !r.updateInfo || r.updateInfo.version === app.getVersion())) send('peek', { kind: 'update', text: 'لديك أحدث إصدار', sub: 'v' + app.getVersion() });
  }).catch(() => { if (manual) send('peek', { kind: 'update', text: 'تعذّر التحقق من التحديث', sub: '' }); });
}
function installUpdate() { if (autoUpdater && updateReady) { app.isQuitting = true; autoUpdater.quitAndInstall(true, true); } }
ipcMain.on('update:install', installUpdate);
ipcMain.handle('app:version', () => app.getVersion());

// ---------------------------------------------------------------- tray
function buildTrayMenu() {
  if (!tray) return;
  const themeItem = (v, label) => ({ label, type: 'radio', checked: settings.theme === v, click: () => { settings.theme = v; saveSettings(); send('theme', effectiveTheme()); } });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'النوتش', enabled: false },
    { type: 'separator' },
    { label: 'العناية بالحاسوب…', click: () => openCare() },
    { label: 'الإعدادات والودجات…', click: () => send('open-settings') },
    { label: 'المظهر', submenu: [themeItem('auto', 'تلقائي (حسب ويندوز)'), themeItem('light', 'فاتح'), themeItem('dark', 'داكن')] },
    { type: 'separator' },
    hooksInstalled()
      ? { label: 'إلغاء ربط Claude Code', click: () => removeHooks() }
      : { label: 'ربط Claude Code', click: () => { const r = installHooks(); send('peek', { kind: 'claude', text: r.ok ? 'تم ربط Claude Code' : 'تعذّر الربط', sub: '' }); } },
    { label: 'التشغيل مع ويندوز', type: 'checkbox', checked: isAutoStart(), click: (i) => { settings.autoStart = i.checked; saveSettings(); applyAutoStart(); } },
    { type: 'separator' },
    { label: updateReady ? 'إعادة التشغيل لتثبيت التحديث' : 'التحقق من التحديثات', click: () => updateReady ? installUpdate() : checkUpdates(true) },
    { label: `الإصدار ${app.getVersion()}`, enabled: false },
    { label: 'إعادة التحميل', click: () => { win.reload(); fetchWeather(); } },
    { label: 'خروج', click: () => app.quit() },
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('النوتش');
  tray.on('click', () => send('open-settings'));
  buildTrayMenu();
}

// ---------------------------------------------------------------- boot
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => send('open-settings'));
  app.whenReady().then(async () => {
    loadSettings();
    if (process.platform === 'win32') app.setAppUserModelId('com.zaid.notch');
    if (settings.firstRun) { settings.firstRun = false; settings.autoStart = true; saveSettings(); }
    applyAutoStart();   // re-assert on every launch (survives updates / moved install path)
    // at Windows sign-in the desktop/DWM may not be ready yet: wait a little before creating the overlay
    const atLogin = process.argv.includes('--autostart') || app.getLoginItemSettings(LOGIN()).wasOpenedAtLogin;
    await new Promise(r => setTimeout(r, atLogin ? 4000 : 0));
    createWindow();
    createTray();
    setupUpdater();
    startServer();
    startMedia();
    startNotifs();
    win.webContents.on('did-finish-load', () => { send('theme', effectiveTheme()); startWeather(); if (lastTrackKey) lastTrackKey = ''; });
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (mediaProc) try { mediaProc.kill(); } catch {} });
  app.on('window-all-closed', (e) => e.preventDefault());
}
