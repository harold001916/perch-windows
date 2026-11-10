import type { SessionHub } from "./hub.ts";
import type { AgentEntry } from "./state.ts";

/** Feeds `claude agents --json` to the hub every `intervalMs`. Returns a stop function. */
export function startPoller(hub: SessionHub, intervalMs = 3000) {
  let stopped = false;
  let lastError = "";

  (async () => {
    while (!stopped) {
      try {
        const proc = Bun.spawn(["claude", "agents", "--json"], { stdout: "pipe", stderr: "pipe" });
        const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        if (code !== 0) throw new Error(`claude agents exited with ${code}`);
        hub.handleAgents(JSON.parse(out) as AgentEntry[]);
        lastError = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastError) console.error(`poll failed: ${message}`);
        lastError = message;
      }
      await Bun.sleep(intervalMs);
    }
  })();

  return () => {
    stopped = true;
  };
}
