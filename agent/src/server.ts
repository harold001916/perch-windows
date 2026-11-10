/**
 * Two servers: hooks on loopback only, and the panel WebSocket behind the pairing token (loopback too).
 * Windows port: no desktop-app library or focus tracking; pin from the strip's visible sessions.
 */
import { timingSafeEqual } from "node:crypto";
import type { OpenAction, ServerMessage } from "../../shared/protocol.ts";
import type { SessionHub } from "./hub.ts";
import { openSession, waveFocusEnabled, type OpenResult } from "./open-session.ts";
import { parseClientMessage } from "./protocol-guard.ts";
import type { HookEvent } from "./state.ts";
import { WaveRegistry, waveInfoFromHeaders, type WaveInfo } from "./wave.ts";

export interface ServerOptions {
  hub: SessionHub;
  token: string;
  hookPort: number;
  panelPort: number;
  open?: (id: string, cwd: string, pid: number | null, live: boolean, wave: WaveInfo | null, action?: OpenAction) => Promise<OpenResult>;
  waves?: WaveRegistry;
}

const TOPIC = "panel";

export function startServers({ hub, token, hookPort, panelPort, open = openSession, waves = new WaveRegistry() }: ServerOptions) {
  const hookServer = Bun.serve({
    hostname: "127.0.0.1",
    port: hookPort,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method !== "POST" || pathname !== "/hook") return new Response("not found", { status: 404 });
      try {
        const event = (await req.json()) as HookEvent;
        if (typeof event?.session_id === "string" && typeof event.hook_event_name === "string") {
          hub.handleHook(event);
          if (event.hook_event_name === "SessionEnd") waves.delete(event.session_id);
          else {
            const wave = waveInfoFromHeaders(req.headers);
            if (wave && (await waveFocusEnabled())) waves.set(event.session_id, wave);
          }
        }
      } catch {
        return new Response("bad json", { status: 400 });
      }
      return new Response(null, { status: 204 });
    },
  });

  const panelServer = Bun.serve({
    hostname: "127.0.0.1",
    port: panelPort,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true, sessions: hub.snapshot().length });
      if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
      if (!sameSecret(url.searchParams.get("token"), token)) return new Response("unauthorized", { status: 401 });
      if (server.upgrade(req)) return;
      return new Response("expected a WebSocket", { status: 400 });
    },
    websocket: {
      maxPayloadLength: 4 * 1024,
      open(ws) {
        ws.subscribe(TOPIC);
        send(ws, { type: "snapshot", sessions: hub.snapshot(), focusedId: hub.focusedId });
      },
      async message(ws, raw) {
        const msg = parseClientMessage(String(raw));
        if (!msg) return send(ws, { type: "error", message: "invalid message" });
        if (msg.type === "library") return send(ws, { type: "library", sessions: [] });
        const session = hub.get(msg.id);
        if (!session) return send(ws, { type: "error", message: "unknown session" });

        switch (msg.type) {
          case "open": {
            const result = await open(msg.id, session.cwd, hub.pidOf(msg.id), session.live, waves.get(msg.id), msg.action);
            if (result.ok) {
              hub.setFocused(msg.id);
              if (result.notice) send(ws, { type: "notice", message: result.notice });
            }
            else send(ws, { type: "error", message: result.error });
            break;
          }
          case "pin":
            hub.setPinned(msg.id, msg.pinned);
            break;
          case "icon":
            hub.setIcon(msg.id, msg.icon);
            break;
        }
      },
      close(ws) {
        ws.unsubscribe(TOPIC);
      },
    },
  });

  const unsubscribe = hub.subscribe((change) => panelServer.publish(TOPIC, JSON.stringify(change satisfies ServerMessage)));

  return {
    hookServer,
    panelServer,
    stop() {
      waves.clear();
      unsubscribe();
      hookServer.stop(true);
      panelServer.stop(true);
    },
  };
}

function send(ws: { send(data: string): unknown }, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function sameSecret(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
