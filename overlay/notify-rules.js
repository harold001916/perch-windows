/**
 * When to show a Windows notification. Pure of Electron: main.js injects the clock, config, the
 * "is a terminal in front?" probe and the function that actually shows the toast.
 *
 * Notified: a session starts waiting on you (permission, question), fails, or finishes a turn that took
 * at least `doneMinSeconds`. Never for the snapshot at connect time, nor for sessions first seen mid-way.
 */
const WAITING = new Set(["needs_permission", "needs_input", "error"]);
const BUSY = new Set(["working", "compacting"]);
const DEDUPE_MS = 5000;

const DEFAULTS = { enabled: true, done: true, doneMinSeconds: 10, onlyWhenUnfocused: true };

function mergeConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const secs = Number(r.doneMinSeconds);
  return {
    enabled: r.enabled !== false,
    done: r.done !== false,
    doneMinSeconds: Number.isFinite(secs) && secs >= 0 ? secs : DEFAULTS.doneMinSeconds,
    onlyWhenUnfocused: r.onlyWhenUnfocused !== false,
  };
}

function message(session, kind) {
  const detail = session.activity ? String(session.activity) : "";
  switch (kind) {
    case "needs_permission": return { title: `${session.name} necesita tu permiso`, body: detail || "Esperando aprobación" };
    case "needs_input": return { title: `${session.name} te pregunta algo`, body: detail || "Esperando tu respuesta" };
    case "error": return { title: `${session.name} tuvo un error`, body: detail || "La sesión falló" };
    default: return { title: `${session.name} terminó`, body: "Es tu turno" };
  }
}

class Notifier {
  /** @param {{now?: () => number, getConfig: () => object, isTerminalFocused: () => Promise<boolean>, show: (n: {id: string, title: string, body: string}) => void}} deps */
  constructor(deps) {
    this.deps = { now: Date.now, ...deps };
    this.prev = new Map(); // id -> state
    this.workStart = new Map(); // id -> ms when the current busy stretch began
    this.lastShown = new Map(); // `${id}|${kind}` -> ms
  }

  /** Records the current picture without notifying (connect / reconnect). */
  snapshot(sessions) {
    this.prev.clear();
    this.workStart.clear();
    const now = this.deps.now();
    for (const s of sessions) {
      this.prev.set(s.id, s.state);
      if (BUSY.has(s.state)) this.workStart.set(s.id, now);
    }
  }

  remove(id) {
    this.prev.delete(id);
    this.workStart.delete(id);
  }

  async update(session) {
    const now = this.deps.now();
    const before = this.prev.get(session.id);
    this.prev.set(session.id, session.state);

    if (BUSY.has(session.state) && !BUSY.has(before)) this.workStart.set(session.id, now);
    if (before === undefined || before === session.state) return null;

    let kind = null;
    if (WAITING.has(session.state)) kind = session.state;
    else if (session.state === "done" && BUSY.has(before)) {
      const cfg = mergeConfig(this.deps.getConfig());
      const took = now - (this.workStart.get(session.id) ?? now);
      if (cfg.done && took >= cfg.doneMinSeconds * 1000) kind = "done";
    }
    if (!BUSY.has(session.state)) this.workStart.delete(session.id);
    if (!kind) return null;

    const cfg = mergeConfig(this.deps.getConfig());
    if (!cfg.enabled) return null;

    const key = `${session.id}|${kind}`;
    if (now - (this.lastShown.get(key) ?? -Infinity) < DEDUPE_MS) return null;
    this.lastShown.set(key, now);

    if (cfg.onlyWhenUnfocused && (await this.deps.isTerminalFocused())) return null;

    const n = { id: session.id, ...message(session, kind) };
    this.deps.show(n);
    return n;
  }
}

module.exports = { Notifier, mergeConfig, DEFAULTS };
