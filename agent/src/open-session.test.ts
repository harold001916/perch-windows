import { expect, test } from "bun:test";
import { parseTerminalSettings, resumeCommand, waveResumeLine } from "./open-session.ts";

const id = "11111111-2222-3333-4444-555555555555";

test("settings default to wt and focusing existing windows", () => {
  expect(parseTerminalSettings(undefined)).toEqual({ terminal: "wt", command: undefined, focusExisting: true, waveFocusBlock: false });
  expect(parseTerminalSettings({ terminal: "nope", focusExisting: false })).toMatchObject({ terminal: "wt", focusExisting: false });
});

test("custom command fills placeholders and rejects non-string argv", () => {
  const s = parseTerminalSettings({ terminal: "custom", command: ["alacritty", "--working-directory", "{cwd}", "-e", "claude", "--resume", "{id}"] });
  expect(resumeCommand(s, id, "C:\work", false)).toEqual(["alacritty", "--working-directory", "C:\work", "-e", "claude", "--resume", id]);
  expect(parseTerminalSettings({ terminal: "custom", command: ["ok", 1] }).command).toBeUndefined();
  expect(resumeCommand(parseTerminalSettings({ terminal: "custom" }), id, "C:\\", false)).toBeNull();
});

test("wt falls back to cmd when wt.exe is missing", () => {
  const s = parseTerminalSettings({ terminal: "wt" });
  expect(resumeCommand(s, id, "C:\a", true)?.[0]).toBe("wt.exe");
  expect(resumeCommand(s, id, "C:\a", false)?.[0]).toBe("cmd.exe");
});

test("wave line keeps quotes in paths literal", () => {
  expect(waveResumeLine(id, "C:\Users\O'Neil")).toBe(`Set-Location -LiteralPath 'C:\Users\O''Neil'; claude --resume ${id}`);
});

test("defaultIcon is validated, junk is ignored", () => {
  expect(parseTerminalSettings({ defaultIcon: { character: "cat", color: "#AABBCC" } }).defaultIcon).toEqual({ character: "cat", color: "#aabbcc" });
  expect(parseTerminalSettings({ defaultIcon: { character: "../x", color: "#aabbcc" } }).defaultIcon).toBeUndefined();
  expect(parseTerminalSettings({ defaultIcon: { character: "cat", color: "red" } }).defaultIcon).toBeUndefined();
});

test("open message keeps only whitelisted actions", async () => {
  const { parseClientMessage } = await import("./protocol-guard.ts");
  const id = "11111111-1111-1111-1111-111111111111";
  expect(parseClientMessage(JSON.stringify({ type: "open", id, action: "code" }))).toEqual({ type: "open", id, action: "code" });
  expect(parseClientMessage(JSON.stringify({ type: "open", id, action: "rm -rf" }))).toEqual({ type: "open", id });
});
