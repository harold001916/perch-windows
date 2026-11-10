# Perch for Windows (prototype)

A floating strip at the edge of the screen with one pixel-art creature per Claude Code session, animated by its state. Not affiliated with Anthropic.

> **Credits.** This project is **based on [Perch by Jose Ramon Montes Hermida (elrincondeldev)](https://github.com/elrincondeldev/perch)**, a macOS app released under the MIT license. All the idea, the design, the pixel-art characters and the original state machine and hook protocol are his work. This repository is an **unofficial, modified port for Windows**: the agent runs on Bun, the overlay is rewritten in Electron, and it adds Windows notifications, terminal detection (Wave, Windows Terminal, VS Code…), Wave block focus, any-edge layout, configurable size and click action, and a setup wizard. It is not affiliated with or endorsed by the original author. Please star and support the [original project](https://github.com/elrincondeldev/perch).

```
Claude Code ─ hooks (curl.exe) ─▶ agent (Bun) ◀─ WebSocket 127.0.0.1:7778 ─ overlay (Electron) ─ tray
claude agents --json ─ poll ─▶     └ SQLite: pins, icons (%APPDATA%\perch)
```

## Requirements
Windows 10/11, [Bun](https://bun.sh) 1.3+, Node.js 18+, Git for Windows (Claude Code runs hooks through its bash), Claude Code CLI.

## Quick install (recommended): the setup wizard
1. Install the requirements above. With winget: `winget install Oven-sh.Bun OpenJS.NodeJS.LTS Git.Git`. Claude Code must already work in your terminal.
2. Download or clone this folder anywhere (a path without odd characters; it can be moved later by re-running the wizard).
3. **Double-click `setup.bat`** (or run it from a terminal). The wizard, in Spanish, does this in five steps:
   1. Checks Bun, Node/npm, Git for Windows, curl.exe and `claude`, and tells you the exact command for anything missing.
   2. Installs the dependencies (agent and overlay, including Electron).
   3. Asks which terminal you use (Windows Terminal, cmd, Wave, Alacritty, WezTerm), whether to jump to an already-open session instead of opening a copy, and, for Wave, whether to focus the exact block (see *Terminal settings*).
   4. Asks the edge of the screen, icon size, what a click does (terminal / VS Code / folder) and whether to show notifications.
   5. Offers to install the Claude Code hooks (with a backup), to launch Perch whenever Claude Code starts, and optionally at Windows login. Then it starts Perch.
4. Restart any Claude Code session that was already open so it shows up.

Running `setup.bat` again opens a menu: reconfigure (it proposes your current values), status, start, stop, or disable everything. It writes only `%APPDATA%\perch\*.json` and, if you accept, `~/.claude/settings.json` (backup `settings.json.bak-perch-*`). Nothing leaves your machine.

If PowerShell blocks scripts, `setup.bat` already runs with `-ExecutionPolicy Bypass`. If something is missing right after installing it, open a **new** window so the PATH refreshes.

### Moving to another computer
Copy the folder (without `overlay\node_modules`, `agent\node_modules` if you like) and run `setup.bat` there. Settings are per-machine and are not copied: the wizard creates them.

### Uninstall
`setup.bat` → *Desactivar todo*, or `.\perch.ps1 disable`; delete the folder and `%APPDATA%\perch`. The Windows-login shortcut is removed by the same option (or `.\startup.ps1 remove`).

## Manual install
Same result as the wizard, by hand:
```powershell
cd agent;   bun install
cd ..\overlay; npm i; node node_modules/electron/install.js   # npm 11 skips Electron's postinstall
cd ..\agent;   bun src/perch.ts hooks install                 # adds hooks to ~/.claude/settings.json (backup next to it)
cd ..;         .\start.ps1                                    # agent (hidden) + overlay
.\startup.ps1 install                                         # optional: start at every login
```
Remove: `.\stop.ps1`, `.\startup.ps1 remove`, `bun agent/src/perch.ts hooks uninstall`.

## Use
- The strip shows pinned sessions plus those working or waiting for you (and finished ones for 5 minutes). **+** pins any known session.
- Hover: name and activity. Click: resumes the session in Windows Terminal (`claude --resume <id>` at its cwd). Right-click: pin/unpin, character, color.
- The small tab next to the strip: click to slide the strip off the screen (the tab blinks orange when a session needs you), drag it to snap the strip to any edge of any monitor (horizontal at top/bottom). Collapsed state and edge persist in `%APPDATA%perchoverlay.json`.
- Tray icon: show/hide, notifications, collapse, edge (left/right/top/bottom), **Tamaño** (75–200%), **Al hacer clic abrir…** (Terminal / VS Code / Carpeta), quit.
- Right-click a tile also offers "Abrir en terminal / VS Code / carpeta" regardless of the default click action. VS Code needs the `code` command on PATH (or the default per-user install).
- Hand-editable: `scale` (0.5–2) and `clickAction` (`terminal`|`code`|`folder`) in `overlay.json`; `defaultIcon` (`{"character":"cat","color":"#4f9dde"}`) in `settings.json`, applied to sessions without their own icon (read when the agent starts).

## Enable / disable
`.\perch.ps1 enable` installs the Claude Code hooks and a SessionStart hook that launches Perch whenever Claude Code starts and the agent isn't running. `disable` stops Perch and removes both; `start`, `stop` and `status` do what they say. The Windows-login shortcut is independent (`startup.ps1 install|remove`). Settings edits keep a `settings.json.bak-perch-*` backup.

## Differences from the macOS version
- No Claude desktop app integration (the `claude://` link and its logs are macOS-only), so click opens a terminal instead and there is no session library or focus ring.
- Overlay is Electron, not native. No global shortcuts yet.
- Everything stays on `127.0.0.1`; the WebSocket needs the token in `%APPDATA%\perch\config.json`. No `--pi`/LAN mode.

## Notifications
Windows toasts when a session needs permission, asks a question, errors, or finishes a turn that took at least 10 s. Clicking the toast opens the session (same logic as clicking its tile). Nothing fires for the snapshot at connect time, for sessions first seen mid-way, or twice in 5 s for the same session/event. Tray menu: on/off. Fine-tune in `%APPDATA%perchoverlay.json` (read on every event):
```json
{ "notifications": { "enabled": true, "done": true, "doneMinSeconds": 10, "onlyWhenUnfocused": true } }
```
`onlyWhenUnfocused` skips the toast while a terminal/editor (Wave, Windows Terminal, VS Code, Cursor, PowerShell, cmd…) is the foreground window.

## Develop
`cd agent && bun test && bunx tsc --noEmit`; `cd overlay && node --test notify-rules.test.js`. Overlay debug: set `PERCH_SHOT=<file.png>` to save a screenshot after 5 s and exit, `PERCH_EVAL=<file.js>` to run JS in the renderer, `PERCH_NOTIFYLOG=<file>` to log every notification shown.

## License
MIT, as the original. See [LICENSE](LICENSE): it keeps the original copyright notice of Jose Ramon Montes Hermida and adds one for the Windows modifications.

## Configuration reference
| File (`%APPDATA%\perch\`) | Key | Values | Default | When it applies |
|---|---|---|---|---|
| `settings.json` | `terminal` | `wt`, `cmd`, `wave`, `custom` | `wt` | every click |
| | `command` | argv with `{id}` `{cwd}` (for `custom`) | none | every click |
| | `focusExisting` | `true`/`false` | `true` | every click |
| | `waveFocusBlock` | `true`/`false` | `false` | within ~5 s; re-run `hooks install` once |
| | `defaultIcon` | `{"character","color"}` | `default`, `#d97757` | agent start |
| `overlay.json` | `edge` | `left` `right` `top` `bottom` | `right` | live (tray or drag) |
| | `scale` | 0.5–2 | `1` | live (tray) |
| | `clickAction` | `terminal` `code` `folder` | `terminal` | live (tray) |
| | `notifications` | see *Notifications* | on | every event |
| `config.json` | `token` | generated | — | do not share; it guards the WebSocket |

The wizard writes these for you; edit them by hand only for fine-tuning. Then `.\perch.ps1 stop` / `start` to restart.

### Troubleshooting
- **`!` instead of `+` in the strip**: the overlay can't reach the agent. Run `.\perch.ps1 status`, then `.\perch.ps1 start`. Agent logs: `%APPDATA%\perch\agent.err.log`.
- **No sessions appear**: hooks missing (`.\perch.ps1 status` says so) or the session was opened before installing them; restart it.
- **Hooks do nothing**: Claude Code runs them through Git Bash; check `git --version` works and `curl.exe` exists.
- **Click opens nothing / a new terminal**: see *Terminal settings* below.

## Terminal settings (`%APPDATA%\perch\settings.json`, read on every click)
```json
{ "terminal": "wave", "focusExisting": true }
```
- `focusExisting` (default `true`): a live session is located through its Claude process tree (Wave, Windows Terminal, VS Code, Cursor, Alacritty, WezTerm…) and that window is brought to the front, so no second instance of the session opens.
- `terminal` is used when the session isn't running: `wt` (default), `cmd`, `wave` (copies `Set-Location …; claude --resume <id>` to the clipboard and focuses Wave: Wave can't start a block from outside without its JWT, which Perch deliberately doesn't copy) or `custom` with `"command": ["alacritty","--working-directory","{cwd}","-e","claude","--resume","{id}"]`.
- `waveFocusBlock` (default `false`, Wave only): after raising Wave's window, also focus the session's exact block with `wsh focusblock`. The hooks (run inside the session's Wave block) forward `WAVETERM_BLOCKID`, `WAVETERM_TABID` and `WAVETERM_JWT` to the agent through curl's environment expansion, so nothing secret appears on a command line. The JWT is a Wave credential: it is kept **only in the agent's memory**, only while this option is on, never written to SQLite, logs or the WebSocket, and dropped on `SessionEnd`. Re-run `bun agent/src/perch.ts hooks install` after updating so the hooks forward it.
- Limit: `focusblock` acts inside Wave's current tab; if it can't focus the block Perch still raises the window and shows the reason in a toast. Other terminals are focused at window level.
