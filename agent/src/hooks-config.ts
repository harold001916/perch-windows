import { HOOK_PORT } from "./config.ts";

/** Hook events the agent needs to track session state. */
export const PANEL_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
] as const;

export const HOOK_URL = `http://127.0.0.1:${HOOK_PORT}/hook`;

/**
 * The `hooks` block for settings.json, forwarding every event to the agent.
 *
 * A command hook with curl rather than `"type": "http"`: when the agent is down,
 * http hooks add a "hook error" to the transcript of every session, while
 * `curl … || true` stays silent. Hooks stay synchronous so events arrive in order.
 */
export function buildPanelHooks() {
  const wave = ['BLOCKID', 'TABID', 'JWT'].map((n) => `--variable '%WAVETERM_${n}=' `).join('');
  const headers = [['Block', 'BLOCKID'], ['Tab', 'TABID'], ['Jwt', 'JWT']].map(([h, n]) => `--expand-header 'X-Wave-${h}: {{WAVETERM_${n}}}' `).join('');
  const command = `curl.exe -s -m 1 -H 'Content-Type: application/json' ${wave}${headers}--data-binary @- ${HOOK_URL} >/dev/null 2>&1 || true`;
  return Object.fromEntries(
    PANEL_EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command, timeout: 2 }] }]]),
  );
}

/** True for handlers installed by this project, including the earlier `http` variant. */
export function isPanelHook(handler: { type?: string; url?: string; command?: unknown }) {
  if (handler.type === "http") return handler.url === HOOK_URL;
  return handler.type === "command" && typeof handler.command === "string" && handler.command.includes(HOOK_URL);
}

type Handler = { type?: string; url?: string; command?: unknown; [k: string]: unknown };
type MatcherGroup = { matcher?: string; hooks: Handler[] };
export type Settings = { hooks?: Record<string, MatcherGroup[]>; [k: string]: unknown };

/** `settings` with our hooks removed, then added back when `install`; everything else stays as it was. */
export function mergeHooks(settings: Settings, { install }: { install: boolean }): Settings {
  const hooks: Record<string, MatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((h) => !isPanelHook(h)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
  }
  if (install) {
    for (const [event, groups] of Object.entries(buildPanelHooks())) hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  const { hooks: _, ...rest } = settings;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

const AUTOSTART_MARK = "perch-autostart";

/**
 * SessionStart hook that launches Perch when Claude Code starts and the agent isn't answering.
 * The curl probe makes the common case (already running) cost one local request; otherwise start.ps1
 * is launched detached so the hook returns at once. Forward slashes: bash would eat backslashes.
 */
export function buildAutostartHook(startScript: string) {
  const script = startScript.replaceAll("\\", "/");
  const command =
    `curl.exe -s -m 1 http://127.0.0.1:${HOOK_PORT}/ >/dev/null 2>&1 || ` +
    `powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}'" >/dev/null 2>&1; : ${AUTOSTART_MARK}`;
  return { type: "command", command, timeout: 5 };
}

export function isAutostartHook(handler: Handler) {
  return handler.type === "command" && typeof handler.command === "string" && handler.command.includes(AUTOSTART_MARK);
}

/** `settings` with our autostart hook removed, then added (first in SessionStart) when `install`. */
export function mergeAutostart(settings: Settings, { install, startScript }: { install: boolean; startScript: string }): Settings {
  const hooks: Record<string, MatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((h) => !isAutostartHook(h)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
  }
  if (install) hooks.SessionStart = [{ hooks: [buildAutostartHook(startScript)] }, ...(hooks.SessionStart ?? [])];
  const { hooks: _, ...rest } = settings;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

export function hasAutostart(settings: Settings) {
  return Object.values(settings.hooks ?? {}).some((groups) => groups.some((group) => group.hooks.some(isAutostartHook)));
}

export function hasPanelHooks(settings: Settings) {
  return Object.values(settings.hooks ?? {}).some((groups) => groups.some((group) => group.hooks.some(isPanelHook)));
}
