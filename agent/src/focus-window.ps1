# Finds the terminal window hosting a process and brings it to the front.
# Usage: focus-window.ps1 -TargetPid <pid>   (also: -HostOnly to print the host without focusing)
# Prints one JSON line: {"found":true,"host":"Wave.exe","hwnd":123} or {"found":false}
param([int]$TargetPid, [switch]$HostOnly)
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System; using System.Runtime.InteropServices;
public class PerchWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$hosts = "Wave","WindowsTerminal","Code","Cursor","Windsurf","alacritty","wezterm-gui","mintty","Hyper","Tabby","WindowsTerminalPreview","warp"
$procs = @{}; Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }

function Find-Window($p) {
  $gp = Get-Process -Id $p.ProcessId
  if ($gp -and $gp.MainWindowHandle -ne 0) { return $gp }
  $base = $p.Name -replace "\.exe$", ""
  if ($hosts -contains $base) {
    return Get-Process -Name $base | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  }
}

$hit = $null
# Pass 1: known terminal hosts anywhere up the chain (Warp's shell has its own hidden console window,
# which would otherwise be picked first). Pass 2: nearest ancestor with any window (cmd/conhost windows).
foreach ($knownOnly in $true, $false) {
  $cur = $procs[[int]$procs[$TargetPid].ParentProcessId]; $depth = 0
  while ($cur -and $depth -lt 12) {
    if ($cur.Name -ieq "explorer.exe") { break }
    $base = $cur.Name -replace "\.exe$", ""
    if (-not $knownOnly -or $hosts -contains $base) {
      $w = Find-Window $cur
      if ($w) { $hit = [pscustomobject]@{ Name = $cur.Name; Hwnd = [int64]$w.MainWindowHandle }; break }
    }
    $cur = $procs[[int]$cur.ParentProcessId]; $depth++
  }
  if ($hit) { break }
}
if (-not $hit) { '{"found":false}'; exit 0 }
if (-not $HostOnly) {
  $h = [IntPtr]$hit.Hwnd
  if ([PerchWin]::IsIconic($h)) { [PerchWin]::ShowWindowAsync($h, 9) | Out-Null }
  [PerchWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [PerchWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) # Alt tap lifts the foreground lock
  [PerchWin]::SetForegroundWindow($h) | Out-Null
}
"{`"found`":true,`"host`":`"$($hit.Name)`",`"hwnd`":$($hit.Hwnd)}"
