/**
 * Opens a session. A live session is found by walking up from its Claude pid to the terminal window
 * that hosts it (Wave, Windows Terminal, VS Code...), which is brought to the front: no second
 * instance of the same session. Otherwise it is resumed with the terminal chosen in
 * %APPDATA%\perch\settings.json.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { OpenAction, SessionIcon } from "../../shared/protocol.ts";
import { DATA_DIR } from "./config.ts";
import { isSessionId } from "./protocol-guard.ts";
import { focusWaveBlock, type WaveInfo } from "./wave.ts";

export type OpenResult = { ok: true; notice?: string } | { ok: false; error: string };

export interface TerminalSettings {
  /** wt = Windows Terminal, cmd, wave = copy the resume command and focus Wave, custom = `command`. */
  terminal: "wt" | "cmd" | "wave" | "custom";
  /** For `custom`: argv with {id} and {cwd} placeholders, e.g. ["alacritty","--working-directory","{cwd}","-e","claude","--resume","{id}"]. */
  command?: string[];
  /** Focus the window hosting a live session instead of opening a new one (default true). */
  focusExisting: boolean;
  /** Wave only: after raising the window, focus the session's exact block. Needs the block's JWT, kept in memory (see wave.ts). */
  waveFocusBlock: boolean;
  /** Icon for sessions that have none (read at agent start). Validated like a panel icon. */
  defaultIcon?: SessionIcon;
}

export const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const FOCUS_SCRIPT = join(import.meta.dir, "focus-window.ps1");

export function parseTerminalSettings(raw: unknown): TerminalSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const terminal = ["wt", "cmd", "wave", "custom"].includes(String(r.terminal)) ? (r.terminal as TerminalSettings["terminal"]) : "wt";
  const command = Array.isArray(r.command) && r.command.every((a) => typeof a === "string") ? (r.command as string[]) : undefined;
  const di = r.defaultIcon as Partial<SessionIcon> | undefined;
  const defaultIcon =
    di && typeof di.character === "string" && /^[a-z0-9-]{1,32}$/.test(di.character) && typeof di.color === "string" && /^#[0-9a-f]{6}$/i.test(di.color)
      ? { character: di.character, color: di.color.toLowerCase() }
      : undefined;
  return { terminal, command, focusExisting: r.focusExisting !== false, waveFocusBlock: r.waveFocusBlock === true, defaultIcon };
}

export async function loadTerminalSettings(): Promise<TerminalSettings> {
  const file = Bun.file(SETTINGS_FILE);
  try {
    return parseTerminalSettings((await file.exists()) ? await file.json() : {});
  } catch {
    return parseTerminalSettings({});
  }
}

/** argv for resuming `id` in `cwd`; null when the settings can't produce one. */
export function resumeCommand(s: TerminalSettings, id: string, cwd: string, hasWt: boolean): string[] | null {
  const fill = (a: string) => a.replaceAll("{id}", id).replaceAll("{cwd}", cwd);
  if (s.terminal === "custom") return s.command?.length ? s.command.map(fill) : null;
  if (s.terminal === "wt" && hasWt) return ["wt.exe", "-d", cwd, "claude", "--resume", id];
  return ["cmd.exe", "/c", "start", "", "/D", cwd, "claude", "--resume", id];
}

/** PowerShell line to paste in a Wave block. Single quotes are doubled so odd paths stay literal. */
export function waveResumeLine(id: string, cwd: string) {
  return `Set-Location -LiteralPath '${cwd.replaceAll("'", "''")}'; claude --resume ${id}`;
}

let waveCache = { at: 0, on: false };
/** Cached for a few seconds: asked on every hook event, and settings.json is edited by hand. */
export async function waveFocusEnabled(): Promise<boolean> {
  if (Date.now() - waveCache.at > 5000) waveCache = { at: Date.now(), on: (await loadTerminalSettings()).waveFocusBlock };
  return waveCache.on;
}

async function run(argv: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", env: { ...process.env, ...env } });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function focusHost(pid: number): Promise<string | null> {
  const ps = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", FOCUS_SCRIPT, "-TargetPid", String(pid)];
  try {
    const res = JSON.parse(await run(ps));
    return res.found ? String(res.host) : null;
  } catch {
    return null;
  }
}

/** Code.exe next to the `code` shim (…\bin\code.cmd), or the default per-user install. Spawned directly: no cmd.exe, so odd paths can't be interpreted. */
export function vscodeExe(): string | null {
  const shim = Bun.which("code");
  const candidates = [shim ? join(dirname(shim), "..", "Code.exe") : "", join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe")];
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

async function openFolderOrCode(action: "code" | "folder", cwd: string): Promise<OpenResult> {
  if (!isAbsolute(cwd) || !existsSync(cwd)) return { ok: false, error: "la carpeta de la sesión ya no existe" };
  const exe = action === "code" ? vscodeExe() : "explorer.exe";
  if (!exe) return { ok: false, error: "VS Code no encontrado (comando 'code')" };
  try {
    Bun.spawn([exe, cwd], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function openSession(id: string, cwd: string, pid: number | null, live: boolean, wave: WaveInfo | null = null, action: OpenAction = "terminal"): Promise<OpenResult> {
  if (!isSessionId(id)) return { ok: false, error: "invalid session id" };
  if (action === "code" || action === "folder") return openFolderOrCode(action, cwd);
  const settings = await loadTerminalSettings();

  if (live && pid && settings.focusExisting) {
    const host = await focusHost(pid);
    if (host) {
      if (host === "Wave.exe" && settings.waveFocusBlock && wave) {
        const r = await focusWaveBlock(wave);
        if (!r.ok) return { ok: true, notice: `Wave: ventana enfocada, pero no el bloque (${r.error})` };
      }
      return { ok: true };
    }
  }

  if (settings.terminal === "wave") {
    // Wave can't start a block from outside without its JWT, which we don't copy: hand over the command instead.
    const copy = ["powershell.exe", "-NoProfile", "-Command", "Set-Clipboard -Value $env:PERCH_CLIP"];
    await run(copy, { PERCH_CLIP: waveResumeLine(id, cwd) });
    await focusHostByName("Wave");
    return { ok: true, notice: "Comando copiado: pégalo en una pestaña de Wave" };
  }

  const argv = resumeCommand(settings, id, cwd, Bun.which("wt.exe") !== null);
  if (!argv) return { ok: false, error: "terminal personalizada sin 'command' en settings.json" };
  try {
    Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Brings the first window of a process name to the front (used when no live pid is known). */
async function focusHostByName(name: string) {
  const script = `$p=Get-Process -Name ${name} | ?{$_.MainWindowHandle -ne 0} | select -First 1; if($p){Add-Type '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);' -Name W -Namespace P; [P.W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null}`;
  await run(["powershell.exe", "-NoProfile", "-Command", script]);
}
