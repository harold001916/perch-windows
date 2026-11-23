const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, Notification } = require("electron");
const { execFile } = require("node:child_process");
const { Notifier, mergeConfig } = require("./notify-rules");
const fs = require("node:fs");
const path = require("node:path");

const EDGES = ["left", "right", "top", "bottom"];
const SIDE_WIDTH = 300; // left/right: room for tooltips and menus beside the strip
const BAR_HEIGHT = 300; // top/bottom: room for them below or above it
const dataDir = path.join(process.env.APPDATA || "", "perch");
const settingsFile = path.join(dataDir, "overlay.json");

let win, tray;
const CLICK_ACTIONS = ["terminal", "code", "folder"];
const SCALES = [0.75, 1, 1.25, 1.5, 2];
let settings = { edge: "right", visible: true, collapsed: false, displayId: null, scale: 1, clickAction: "terminal" };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8").replace(/^﻿/, "")) }; } catch {}
if (!EDGES.includes(settings.edge)) settings.edge = "right";
if (!CLICK_ACTIONS.includes(settings.clickAction)) settings.clickAction = "terminal";
settings.scale = Number.isFinite(Number(settings.scale)) ? Math.min(2, Math.max(0.5, Number(settings.scale))) : 1;
const saveSettings = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch {} };

if (!app.requestSingleInstanceLock()) app.quit();

let content = { w: 80, h: 340 };

const horizontal = () => settings.edge === "top" || settings.edge === "bottom";
const display = () => screen.getAllDisplays().find((d) => d.id === settings.displayId) || screen.getPrimaryDisplay();

function place() {
  if (!win) return;
  const { workArea: wa } = display();
  let w, h, x, y;
  if (horizontal()) {
    w = Math.min(Math.max(content.w, 420), wa.width);
    h = BAR_HEIGHT;
    x = wa.x + Math.round((wa.width - w) / 2);
    y = settings.edge === "top" ? wa.y : wa.y + wa.height - h;
  } else {
    w = Math.round(SIDE_WIDTH + 56 * (settings.scale - 1)); // bigger tiles need more room beside them
    h = Math.min(Math.max(content.h, 340), wa.height);
    x = settings.edge === "right" ? wa.x + wa.width - w : wa.x;
    y = wa.y + Math.round((wa.height - h) / 2);
  }
  win.setBounds({ x, y, width: w, height: h });
}

function sendLayout() {
  if (win) win.webContents.send("layout", layout());
}
const layout = () => ({ edge: settings.edge, collapsed: settings.collapsed, scale: settings.scale, clickAction: settings.clickAction });
function setScale(scale) { settings.scale = scale; saveSettings(); place(); sendLayout(); tray.setContextMenu(trayMenu()); }
function setClickAction(action) { settings.clickAction = action; saveSettings(); sendLayout(); tray.setContextMenu(trayMenu()); }

function createWindow() {
  win = new BrowserWindow({
    width: SIDE_WIDTH, height: 340, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => { place(); if (settings.visible) win.showInactive(); });
}

function trayMenu() {
  const label = { left: "izquierda", right: "derecha", top: "arriba", bottom: "abajo" };
  return Menu.buildFromTemplate([
    { label: settings.visible ? "Ocultar tira" : "Mostrar tira", click: () => { settings.visible = !settings.visible; settings.visible ? win.showInactive() : win.hide(); saveSettings(); tray.setContextMenu(trayMenu()); } },
    { label: "Notificaciones", type: "checkbox", checked: mergeConfig(notificationsConfig()).enabled, click: (item) => { settings.notifications = { ...(settings.notifications || {}), enabled: item.checked }; saveSettings(); } },
    { label: "Colapsar a la pestaña", type: "checkbox", checked: settings.collapsed, click: (item) => setCollapsed(item.checked, true) },
    { type: "separator" },
    ...EDGES.map((e) => ({ label: `Borde: ${label[e]}`, type: "radio", checked: settings.edge === e, click: () => setEdge(e) })),
    { type: "separator" },
    { label: "Tamaño", submenu: SCALES.map((s) => ({ label: `${Math.round(s * 100)}%`, type: "radio", checked: settings.scale === s, click: () => setScale(s) })) },
    { label: "Al hacer clic abrir…", submenu: CLICK_ACTIONS.map((a) => ({ label: { terminal: "Terminal", code: "VS Code", folder: "Carpeta" }[a], type: "radio", checked: settings.clickAction === a, click: () => setClickAction(a) })) },
    { type: "separator" },
    { label: "Salir de Perch", click: () => app.quit() },
  ]);
}

function setEdge(edge, displayId = settings.displayId) {
  settings.edge = edge; settings.displayId = displayId; saveSettings();
  place(); sendLayout(); tray.setContextMenu(trayMenu());
}
function setCollapsed(collapsed, notify) {
  settings.collapsed = collapsed; saveSettings();
  tray.setContextMenu(trayMenu());
  if (notify) sendLayout();
}

/** Snaps to the display under the drop point and its nearest edge. */
function dropAt(x, y) {
  const d = screen.getDisplayNearestPoint({ x, y });
  const { x: ax, y: ay, width, height } = d.workArea;
  const dist = { left: x - ax, right: ax + width - x, top: y - ay, bottom: ay + height - y };
  setEdge(EDGES.reduce((best, e) => (dist[e] < dist[best] ? e : best), "right"), d.id === screen.getPrimaryDisplay().id ? null : d.id);
}

function createTray() {
  const size = 16, buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { // BGRA, orange square
    const x = i % size, y = Math.floor(i / size), edge = x < 2 || y < 2 || x > 13 || y > 13;
    buf.set(edge ? [0, 0, 0, 0] : [0x57, 0x77, 0xd9, 0xff], i * 4);
  }
  tray = new Tray(nativeImage.createFromBitmap(buf, { width: size, height: size }));
  tray.setToolTip("Perch");
  tray.setContextMenu(trayMenu());
}

ipcMain.handle("boot", () => {
  let token = null;
  try { token = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")).token; } catch {}
  const characters = JSON.parse(fs.readFileSync(path.join(__dirname, "characters.json"), "utf8"));
  return { token, characters, ...layout() };
});
ipcMain.on("interactive", (_e, on) => win && win.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.on("size", (_e, w, h) => { content = { w: Math.ceil(w), h: Math.ceil(h) }; place(); });
ipcMain.on("collapsed", (_e, collapsed) => setCollapsed(!!collapsed, false));
// ---------- notifications ----------
const TERMINAL_HOSTS = new Set(["wave", "windowsterminal", "windowsterminalpreview", "code", "cursor", "windsurf", "alacritty", "wezterm-gui", "mintty", "hyper", "tabby", "warp", "powershell", "pwsh", "cmd", "conhost"]);
const FOREGROUND_PS = path.join(__dirname, "foreground.ps1");

/** Read fresh so hand edits to overlay.json apply without a restart. */
function notificationsConfig() {
  try { return JSON.parse(fs.readFileSync(settingsFile, "utf8").replace(/^﻿/, "")).notifications; } catch { return undefined; }
}
function isTerminalFocused() {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", FOREGROUND_PS], { timeout: 4000, windowsHide: true }, (err, out) => resolve(!err && TERMINAL_HOSTS.has(String(out).trim().toLowerCase())));
  });
}
const notifier = new Notifier({
  getConfig: notificationsConfig,
  isTerminalFocused,
  show({ id, title, body }) {
    if (process.env.PERCH_NOTIFYLOG) fs.appendFileSync(process.env.PERCH_NOTIFYLOG, JSON.stringify({ id, title, body }) + "\n"); // debug
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on("click", () => win && win.webContents.send("open-session", id));
    n.show();
  },
});
const asSession = (s) => (s && typeof s.id === "string" && typeof s.state === "string" ? { id: s.id, name: String(s.name || "Sesión").slice(0, 80), state: s.state, activity: typeof s.activity === "string" ? s.activity.slice(0, 120) : null } : null);
ipcMain.on("sessions-snapshot", (_e, list) => notifier.snapshot((Array.isArray(list) ? list : []).map(asSession).filter(Boolean)));
ipcMain.on("session-changed", (_e, s) => { const x = asSession(s); if (x) notifier.update(x).catch(() => {}); });
ipcMain.on("session-removed", (_e, id) => typeof id === "string" && notifier.remove(id));

ipcMain.on("drop", (_e, x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) dropAt(x, y); });

app.setAppUserModelId("com.perch.win");
app.whenReady().then(() => { createWindow(); createTray(); screen.on("display-metrics-changed", place); screen.on("display-removed", () => { settings.displayId = null; place(); }); });
app.on("window-all-closed", () => app.quit());

// Debug: PERCH_SHOT=<file.png> saves a screenshot after 5s and quits.
if (process.env.PERCH_EVAL) { // Debug: run a JS file in the renderer 3s after start (to simulate clicks).
  app.whenReady().then(() => setTimeout(() => win.webContents.executeJavaScript(fs.readFileSync(process.env.PERCH_EVAL, "utf8")), 3000));
}
if (process.env.PERCH_SHOT) {
  app.whenReady().then(() => setTimeout(async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(process.env.PERCH_SHOT, img.toPNG());
    const cls = await win.webContents.executeJavaScript("document.body.className");
    fs.writeFileSync(process.env.PERCH_SHOT + ".txt", `${cls} bounds=${JSON.stringify(win.getBounds())} settings=${JSON.stringify(settings)}`);
    app.quit();
  }, 5000));
}
