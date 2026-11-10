import { expect, test } from "bun:test";
import { buildPanelHooks } from "./hooks-config.ts";
import { WaveRegistry, waveInfoFromHeaders, wshEnv } from "./wave.ts";

const block = "0ba0d0a6-71b8-40f7-8c52-ba210b14c941";
const tab = "f4cd0d2e-23a8-4fc8-bc40-c0de09cfae69";
const jwt = "aaaa.bbbb.cccc";
const headers = (o: Record<string, string>) => new Headers(o);

test("reads a complete, valid Wave identity", () => {
  expect(waveInfoFromHeaders(headers({ "x-wave-block": block, "x-wave-tab": tab, "x-wave-jwt": jwt }))).toEqual({ blockId: block, tabId: tab, jwt });
});

test("rejects missing or malformed values", () => {
  expect(waveInfoFromHeaders(headers({}))).toBeNull(); // hook not running inside Wave
  expect(waveInfoFromHeaders(headers({ "x-wave-block": block, "x-wave-tab": tab }))).toBeNull();
  expect(waveInfoFromHeaders(headers({ "x-wave-block": "x; rm -rf", "x-wave-tab": tab, "x-wave-jwt": jwt }))).toBeNull();
  expect(waveInfoFromHeaders(headers({ "x-wave-block": block, "x-wave-tab": tab, "x-wave-jwt": "not a jwt" }))).toBeNull();
});

test("wsh env drops stale WAVETERM_* and carries the target block", () => {
  const env = wshEnv({ blockId: block, tabId: tab, jwt }, { PATH: "p", WAVETERM_JWT: "old", WAVETERM_CLIENTID: "c" });
  expect(env).toEqual({ PATH: "p", WAVETERM_JWT: jwt, WAVETERM_TABID: tab, WAVETERM_BLOCKID: block });
});

test("registry keeps ids per session and forgets them", () => {
  const r = new WaveRegistry();
  r.set("s1", { blockId: block, tabId: tab, jwt });
  expect(r.get("s1")?.blockId).toBe(block);
  r.delete("s1");
  expect(r.get("s1")).toBeNull();
});

test("hook command never puts the JWT on the command line", () => {
  const command = (buildPanelHooks().Stop![0] as any).hooks[0].command as string;
  expect(command).toContain("{{WAVETERM_JWT}}"); // curl expands it from the environment
  expect(command).not.toMatch(/\$WAVETERM|\$\{WAVETERM/); // not the shell
});
