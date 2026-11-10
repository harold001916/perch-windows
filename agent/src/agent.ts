import { PANEL_PORT } from "../../shared/protocol.ts";
import { HOOK_PORT, loadConfig } from "./config.ts";
import { SessionHub } from "./hub.ts";
import { loadTerminalSettings } from "./open-session.ts";
import { startPoller } from "./poller.ts";
import { startServers } from "./server.ts";
import { Store } from "./store.ts";

/** Runs until Ctrl+C. */
export async function runAgent() {
  const config = await loadConfig();
  const store = new Store(config.dbPath);
  const hub = new SessionHub(store);
  hub.defaultIcon = (await loadTerminalSettings()).defaultIcon ?? hub.defaultIcon;
  const servers = startServers({ hub, token: config.token, hookPort: HOOK_PORT, panelPort: PANEL_PORT });
  const stopPoller = startPoller(hub);
  const pruneTimer = setInterval(() => hub.prune(), 10 * 60 * 1000);

  hub.subscribe((change) => {
    if (change.type !== "session") return;
    const s = change.session;
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`${time}  ${s.id.slice(0, 8)}  ${s.state.padEnd(16)} ${s.name}${s.pinned ? " *" : ""}  ${s.activity ?? ""}`);
  });

  console.log(`perch agent (Windows)
  hooks : http://127.0.0.1:${HOOK_PORT}/hook
  panel : ws://127.0.0.1:${PANEL_PORT}/ws
  data  : ${config.dataDir}
`);

  const shutdown = () => {
    clearInterval(pruneTimer);
    stopPoller();
    servers.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
