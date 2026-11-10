/**
 * Wave Terminal block focus. Hooks run inside the session's Wave block, so they can forward that
 * block's WAVETERM_BLOCKID / WAVETERM_TABID / WAVETERM_JWT as headers. `wsh focusblock` needs the JWT,
 * which is a credential: it lives only in this process's memory (never in SQLite, logs or the WebSocket),
 * is stored only while `waveFocusBlock` is on, and is dropped on SessionEnd.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface WaveInfo {
  blockId: string;
  tabId: string;
  jwt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[\w-]{4,2048}\.[\w-]{1,2048}\.[\w-]{1,2048}$/;

/** Validated Wave identity from hook headers, or null when the hook didn't run inside a Wave block. */
export function waveInfoFromHeaders(h: Pick<Headers, "get">): WaveInfo | null {
  const blockId = h.get("x-wave-block")?.trim() ?? "";
  const tabId = h.get("x-wave-tab")?.trim() ?? "";
  const jwt = h.get("x-wave-jwt")?.trim() ?? "";
  return UUID.test(blockId) && UUID.test(tabId) && JWT.test(jwt) ? { blockId, tabId, jwt } : null;
}

export class WaveRegistry {
  private bySession = new Map<string, WaveInfo>();
  set(sessionId: string, info: WaveInfo) {
    this.bySession.set(sessionId, info);
  }
  get(sessionId: string) {
    return this.bySession.get(sessionId) ?? null;
  }
  delete(sessionId: string) {
    this.bySession.delete(sessionId);
  }
  clear() {
    this.bySession.clear();
  }
  get size() {
    return this.bySession.size;
  }
}

/** Environment for wsh: ours minus any stale WAVETERM_*, plus the target block's identity. */
export function wshEnv(info: WaveInfo, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !k.startsWith("WAVETERM_")) env[k] = v;
  return { ...env, WAVETERM_JWT: info.jwt, WAVETERM_TABID: info.tabId, WAVETERM_BLOCKID: info.blockId };
}

export function wshPath(): string | null {
  const onPath = Bun.which("wsh");
  if (onPath) return onPath;
  const local = process.env.LOCALAPPDATA;
  const fallback = local ? join(local, "waveterm", "Data", "bin", "wsh.exe") : null;
  return fallback && existsSync(fallback) ? fallback : null;
}

export async function focusWaveBlock(info: WaveInfo, timeoutMs = 4000): Promise<{ ok: true } | { ok: false; error: string }> {
  const wsh = wshPath();
  if (!wsh) return { ok: false, error: "wsh no encontrado" };
  const proc = Bun.spawn([wsh, "focusblock", "-b", info.blockId], {
    env: wshEnv(info),
    stdout: "ignore",
    stderr: "pipe",
    windowsHide: true,
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code === 0) return { ok: true };
  // wsh's message can echo ids but never the JWT; keep it short for the toast.
  return { ok: false, error: err.replace(/\s+/g, " ").trim().slice(0, 120) || `wsh salió con ${code}` };
}
