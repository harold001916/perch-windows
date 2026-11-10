const WS_URL = "ws://127.0.0.1:7778/ws";
const FIVE_MIN = 5 * 60 * 1000;
const ACTIVE = new Set(["working", "needs_permission", "needs_input", "compacting", "error"]);
const COLORS = ["#d97757", "#4f9dde", "#58b368", "#b58be0", "#e0b44f", "#e06b9d"];
const STATE_LABEL = { idle: "idle", working: "working", needs_permission: "needs permission", needs_input: "asking you", compacting: "compacting", done: "done", error: "error", ended: "closed" };

const strip = document.getElementById("strip");
const wrap = document.getElementById("wrap");
const tab = document.getElementById("tab");
const tip = document.getElementById("tip");
const menu = document.getElementById("menu");
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(text, err = false) {
  toastEl.textContent = text;
  toastEl.className = `show${err ? " err" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ""), 4000);
}
let chars = {}, sessions = new Map(), focusedId = null, ws, retry = 1000, connected = false;
let blink = false, frame = 0, edge = "right", clickAction = "terminal";

// ---------- sprites ----------
function mix(hex, to, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = n(hex), b = n(to);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function drawSprite(canvas, char, color, { walk = false, eyes = "open" } = {}) {
  const c = chars[char] || chars.default;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 16, 16);
  const pal = { B: color, D: mix(color, "#000000", 0.35), L: mix(color, "#ffffff", 0.35), F: "#f1e4d3", P: "#f2a1b6" };
  const rows = [...c.body];
  if (walk && c.walk) c.walk.rows.forEach((r, i) => (rows[c.walk.row + i] = r));
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { ctx.fillStyle = pal[ch]; ctx.fillRect(x, y, 1, 1); } }));
  const { y, left, right } = c.eyes;
  for (const x of [left, right]) {
    if (eyes === "open") { ctx.fillStyle = c.eyeColor || "#1a1a1a"; ctx.fillRect(x, y, 2, 2); }
    else if (eyes === "closed") { ctx.fillStyle = pal.D; ctx.fillRect(x, y + 1, 2, 1); }
    else { ctx.fillStyle = c.eyeColor || "#1a1a1a"; ctx.fillRect(x, y + 1, 2, 1); }
  }
}

// ---------- model ----------
const isVisible = (s) => s.pinned || ACTIVE.has(s.state) || (s.state === "done" && Date.now() - s.stateSince < FIVE_MIN);
function view(s) {
  const asleep = s.state === "done" && Date.now() - s.stateSince >= FIVE_MIN;
  const cls = { working: "working", needs_permission: "perm", needs_input: "input", compacting: "compacting", error: "error", ended: "ended" }[s.state] || "";
  return { cls: asleep ? "sleep" : s.state === "done" ? "done" : cls, asleep };
}
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}

// ---------- render ----------
function render() {
  strip.replaceChildren();
  const list = [...sessions.values()].filter(isVisible).sort((a, b) =>
    a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.pinned ? (a.position ?? 0) - (b.position ?? 0) : b.stateSince - a.stateSince);
  for (const s of list) {
    const { cls, asleep } = view(s);
    const tile = document.createElement("div");
    tile.className = `tile ${cls}${s.id === focusedId ? " focused" : ""}`;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 16;
    cv.dataset.id = s.id;
    tile.append(cv);
    if (s.state === "working") tile.append(badge("work", "···"));
    if (s.state === "done" && !asleep) tile.append(badge("done", "✓"));
    tile.addEventListener("click", () => send({ type: "open", id: s.id, action: clickAction }));
    tile.addEventListener("contextmenu", (e) => { e.preventDefault(); sessionMenu(s, tile); });
    tile.addEventListener("mouseenter", () => showTip(s, tile));
    tile.addEventListener("mouseleave", () => (tip.hidden = true));
    strip.append(tile);
  }
  const add = document.createElement("div");
  add.className = "tile add";
  add.textContent = connected ? "+" : "!";
  add.title = connected ? "Fijar una sesión" : "Sin conexión con el agente (¿está corriendo?)";
  add.addEventListener("click", () => addMenu(add));
  strip.append(add);
  tab.classList.toggle("attn", collapsed && needsAttention());
  paint();
}
function badge(kind, text) { const b = document.createElement("div"); b.className = `badge ${kind}`; b.textContent = text; return b; }
function paint() {
  for (const cv of strip.querySelectorAll("canvas")) {
    const s = sessions.get(cv.dataset.id);
    if (!s) continue;
    const { asleep } = view(s);
    const sleeping = asleep || s.state === "ended";
    drawSprite(cv, s.icon.character, s.icon.color, {
      walk: s.state === "working" && frame % 2 === 1,
      eyes: sleeping || blink ? "closed" : s.state === "compacting" ? "squint" : "open",
    });
  }
}
setInterval(() => { frame++; paint(); }, 350);
setInterval(() => { blink = true; paint(); setTimeout(() => { blink = false; paint(); }, 140); }, 3500);
setInterval(render, 30000); // done -> asleep after five minutes

// ---------- tooltip & menus ----------
function place(el, anchor) {
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const clampX = (v) => Math.min(Math.max(4, v), innerWidth - w - 4);
  const clampY = (v) => Math.min(Math.max(4, v), innerHeight - h - 4);
  if (edge === "top" || edge === "bottom") { // beside a horizontal strip: below it (top edge) or above it (bottom edge)
    el.style.left = `${clampX(r.left + r.width / 2 - w / 2)}px`;
    el.style.top = `${clampY(edge === "top" ? r.bottom + 10 : r.top - h - 10)}px`;
  } else {
    el.style.left = `${clampX(edge === "right" ? r.left - w - 10 : r.right + 10)}px`;
    el.style.top = `${clampY(r.top + r.height / 2 - h / 2)}px`;
  }
}
function showTip(s, tile) {
  tip.replaceChildren();
  const b = document.createElement("b"); b.textContent = s.name;
  const sp = document.createElement("span"); sp.textContent = s.activity ? s.activity : `${STATE_LABEL[s.state]} · ${ago(s.stateSince)}`;
  tip.append(b, sp);
  place(tip, tile);
}
function openMenu(items, anchor) {
  tip.hidden = true;
  menu.replaceChildren(...items);
  place(menu, anchor);
}
const item = (label, fn) => { const d = document.createElement("div"); d.className = "item"; d.textContent = label; d.onclick = () => { menu.hidden = true; fn(); }; return d; };
const sep = () => Object.assign(document.createElement("div"), { className: "sep" });
function sessionMenu(s, tile) {
  const swatches = document.createElement("div"); swatches.className = "row";
  for (const col of COLORS) {
    const sw = document.createElement("div"); sw.className = "sw"; sw.style.background = col;
    sw.onclick = () => { menu.hidden = true; send({ type: "icon", id: s.id, icon: { ...s.icon, color: col } }); };
    swatches.append(sw);
  }
  const chs = Object.values(chars).map((c) => item(c.label, () => send({ type: "icon", id: s.id, icon: { ...s.icon, character: c.id } })));
  const open = (label, action) => item(label, () => send({ type: "open", id: s.id, action }));
  openMenu([open("Abrir en terminal", "terminal"), open("Abrir en VS Code", "code"), open("Abrir carpeta", "folder"), sep(),
    item(s.pinned ? "Desfijar" : "Fijar", () => send({ type: "pin", id: s.id, pinned: !s.pinned })), sep(), ...chs, sep(), swatches], tile);
}
function addMenu(tile) {
  const rest = [...sessions.values()].filter((s) => !s.pinned && s.state !== "ended").sort((a, b) => b.stateSince - a.stateSince).slice(0, 12);
  openMenu(rest.length ? rest.map((s) => item(s.name, () => send({ type: "pin", id: s.id, pinned: true }))) : [item("No hay sesiones activas", () => {})], tile);
}
const interactive = (on) => window.perch.setInteractive(on);
for (const el of [strip, tab]) {
  el.addEventListener("mouseenter", () => interactive(true));
  el.addEventListener("mouseleave", () => { if (menu.hidden && !dragging) interactive(false); });
}

// ---------- tab: collapse on click, move to another edge on drag ----------
const ARROW = { right: ["▸", "◂"], left: ["◂", "▸"], top: ["▴", "▾"], bottom: ["▾", "▴"] }; // [expanded, collapsed]
let collapsed = false, dragging = false, dragStart = null;
function applyLayout(layout, { slide = false } = {}) {
  edge = layout.edge;
  collapsed = layout.collapsed;
  clickAction = layout.clickAction || "terminal";
  document.documentElement.style.setProperty("--s", String(layout.scale || 1));
  document.body.className = `edge-${edge}${collapsed ? " collapsed" : ""}`;
  tab.textContent = ARROW[edge][collapsed ? 1 : 0];
  if (slide && !collapsed) { strip.classList.add("slide"); setTimeout(() => strip.classList.remove("slide"), 200); }
  menu.hidden = true; tip.hidden = true;
  render();
}
function needsAttention() {
  return [...sessions.values()].some((s) => (s.state === "needs_permission" || s.state === "needs_input" || s.state === "error") && isVisible(s));
}
tab.addEventListener("pointerdown", (e) => { dragStart = { x: e.screenX, y: e.screenY }; tab.setPointerCapture(e.pointerId); });
tab.addEventListener("pointermove", (e) => {
  if (!dragStart || dragging || Math.hypot(e.screenX - dragStart.x, e.screenY - dragStart.y) < 8) return;
  dragging = true; document.body.classList.add("dragging"); interactive(true);
});
tab.addEventListener("pointerup", (e) => {
  const wasDragging = dragging;
  dragStart = null; dragging = false; document.body.classList.remove("dragging");
  if (wasDragging) return window.perch.drop(e.screenX, e.screenY);
  collapsed = !collapsed;
  window.perch.setCollapsed(collapsed);
  applyLayout({ edge, collapsed, scale: currentScale(), clickAction }, { slide: true });
});
const currentScale = () => Number(document.documentElement.style.getPropertyValue("--s")) || 1;
menu.addEventListener("mouseenter", () => interactive(true));
menu.addEventListener("mouseleave", () => { menu.hidden = true; interactive(false); });

// ---------- connection ----------
function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function connect(token) {
  ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  ws.onopen = () => { connected = true; retry = 1000; render(); };
  ws.onclose = () => { connected = false; sessions.clear(); render(); setTimeout(() => connect(token), retry); retry = Math.min(retry * 2, 15000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "snapshot") { sessions = new Map(m.sessions.map((s) => [s.id, s])); focusedId = m.focusedId; window.perch.sessionsSnapshot(m.sessions); }
    else if (m.type === "session") { sessions.set(m.session.id, m.session); window.perch.sessionChanged(m.session); }
    else if (m.type === "removed") { sessions.delete(m.id); window.perch.sessionRemoved(m.id); }
    else if (m.type === "focus") focusedId = m.id;
    else if (m.type === "notice") toast(m.message);
    else if (m.type === "error") toast(m.message, true);
    render();
  };
}

(async () => {
  const boot = await window.perch.boot();
  chars = Object.fromEntries(boot.characters.map((c) => [c.id, c]));
  applyLayout(boot);
  window.perch.onOpenSession((id) => send({ type: "open", id })); // click on a notification
  window.perch.onLayout((layout) => applyLayout(layout, { slide: true }));
  new ResizeObserver(() => window.perch.setSize(wrap.offsetWidth + 20, wrap.offsetHeight + 20)).observe(wrap);
  render();
  if (boot.token) connect(boot.token);
})();
