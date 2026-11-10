import { runAgent } from "./agent.ts";
import { CLAUDE_SETTINGS } from "./config.ts";
import { autostartInstalled, hooksInstalled, writeAutostart, writeHooks } from "./settings.ts";

const [cmd, sub] = process.argv.slice(2);

switch (cmd) {
  case "agent":
    await runAgent();
    break;
  case "hooks":
    if (sub === "install" || sub === "uninstall") {
      const changed = await writeHooks({ install: sub === "install" });
      console.log(changed ? `hooks ${sub}ed in ${CLAUDE_SETTINGS} (backup saved next to it)` : "nothing to change");
    } else {
      console.log(`hooks ${(await hooksInstalled()) ? "installed" : "not installed"} in ${CLAUDE_SETTINGS}`);
    }
    break;
  case "autostart":
    if (sub === "on" || sub === "off") {
      const changed = await writeAutostart({ install: sub === "on" });
      console.log(changed ? `autostart ${sub} (backup saved next to ${CLAUDE_SETTINGS})` : "nothing to change");
    } else {
      console.log(`autostart ${(await autostartInstalled()) ? "on" : "off"}`);
    }
    break;
  default:
    console.log("usage: bun src/perch.ts agent | hooks [install|uninstall] | autostart [on|off]");
}
