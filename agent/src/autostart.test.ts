import { expect, test } from "bun:test";
import { hasAutostart, mergeAutostart, mergeHooks, type Settings } from "./hooks-config.ts";

const script = "C:\\Users\\me\\perch-win\\start.ps1";
const mine = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }] } } as Settings;

test("autostart is added first, is idempotent and keeps other hooks", () => {
  const on = mergeAutostart(mine, { install: true, startScript: script });
  expect(hasAutostart(on)).toBe(true);
  expect(on.hooks!.SessionStart!.length).toBe(2);
  expect(on.hooks!.SessionStart![1]!.hooks[0]!.command).toBe("echo mine");
  expect(JSON.stringify(mergeAutostart(on, { install: true, startScript: script }))).toBe(JSON.stringify(on));
  const cmd = String(on.hooks!.SessionStart![0]!.hooks[0]!.command);
  expect(cmd).toContain("C:/Users/me/perch-win/start.ps1"); // forward slashes for bash
});

test("turning it off restores the original; panel hooks install/uninstall leave it alone", () => {
  const on = mergeAutostart(mine, { install: true, startScript: script });
  expect(mergeAutostart(on, { install: false, startScript: script })).toEqual(mine);
  const withPanel = mergeHooks(on, { install: true });
  expect(hasAutostart(withPanel)).toBe(true);
  expect(hasAutostart(mergeHooks(withPanel, { install: false }))).toBe(true);
});
