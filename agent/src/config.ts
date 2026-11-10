/** Where Perch lives on Windows: %APPDATA%\perch holds config.json (pairing token) and perch.db. */
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOOK_PORT = 7777;

export const DATA_DIR = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "perch");
export const CONFIG_FILE = join(DATA_DIR, "config.json");
export const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

export interface Config {
  dataDir: string;
  dbPath: string;
  token: string;
}

/** Windows ignores POSIX modes; the file sits under the user's profile, which other users can't read. */
export async function loadConfig(): Promise<Config> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = Bun.file(CONFIG_FILE);
  const saved: { token?: string } = (await file.exists()) ? await file.json() : {};
  if (!saved.token) {
    saved.token = randomBytes(24).toString("base64url");
    await Bun.write(CONFIG_FILE, JSON.stringify(saved, null, 2) + "\n");
  }
  return { dataDir: DATA_DIR, dbPath: join(DATA_DIR, "perch.db"), token: saved.token };
}
