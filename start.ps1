# Starts the Perch agent (hidden) and the overlay. Safe to run twice: each checks if it is already up.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bun = (Get-Command bun -ErrorAction Stop).Source
if (-not (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue)) {
  New-Item -ItemType Directory -Force "$env:APPDATA\perch" | Out-Null
  Start-Process $bun -ArgumentList "src/perch.ts", "agent" -WorkingDirectory "$root\agent" -WindowStyle Hidden `
    -RedirectStandardOutput "$env:APPDATA\perch\agent.log" -RedirectStandardError "$env:APPDATA\perch\agent.err.log"
  Start-Sleep 2
}
# The overlay holds a single-instance lock, so a second launch exits by itself.
Start-Process "$root\overlay\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "$root\overlay"
