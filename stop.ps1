# Stops the overlay and the agent.
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "bun.exe" -and $_.CommandLine -like "*perch.ts*agent*") -or
  ($_.Name -eq "electron.exe" -and $_.ExecutablePath -like "*perch-win*")
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
