# Perch control. Usage: .\perch.ps1 <enable|disable|start|stop|status>
#   enable  : install the Claude Code hooks and make Perch launch itself when Claude Code starts
#   disable : stop Perch and remove both (the Windows-login shortcut is separate: startup.ps1)
param([Parameter(Position = 0)][ValidateSet("enable", "disable", "start", "stop", "status")][string]$Action = "status")
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bun = (Get-Command bun -ErrorAction Stop).Source
function Perch([string[]]$a) { Push-Location "$root\agent"; try { & $bun src/perch.ts @a } finally { Pop-Location } }

switch ($Action) {
  "enable"  { Perch "hooks", "install"; Perch "autostart", "on"; & "$root\start.ps1" }
  "disable" { & "$root\stop.ps1"; Perch "autostart", "off"; Perch "hooks", "uninstall" }
  "start"   { & "$root\start.ps1" }
  "stop"    { & "$root\stop.ps1" }
  "status"  {
    Perch "hooks"; Perch "autostart"
    # Any HTTP answer (even 404) means the agent is listening; Get-NetTCPConnection proved unreliable here.
    $up = $false
    try { Invoke-WebRequest -Uri http://127.0.0.1:7777/ -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { if ($_.Exception.Response) { $up = $true } }
    "agent: $(if ($up) { 'running' } else { 'stopped' })"
    "login shortcut: $(if (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Perch.lnk") { 'installed' } else { 'not installed' })"
  }
}
