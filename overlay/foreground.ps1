# Prints the process name of the foreground window (used to skip notifications when a terminal is in front).
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$p = [uint32]0
[FG]::GetWindowThreadProcessId([FG]::GetForegroundWindow(), [ref]$p) | Out-Null
(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
