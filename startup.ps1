# startup.ps1 install | remove : launch Perch at every Windows login (shortcut in the Startup folder).
param([Parameter(Mandatory)][ValidateSet("install", "remove")]$action)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Perch.lnk"
if ($action -eq "remove") { Remove-Item $lnk -ErrorAction SilentlyContinue; "removed $lnk"; return }
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = "powershell.exe"
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\start.ps1`""
$s.WorkingDirectory = $root
$s.Save()
"created $lnk"
