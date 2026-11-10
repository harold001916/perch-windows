# Perch for Windows - asistente de instalacion y configuracion (interactivo).
# Se usa a traves de setup.bat. Se puede volver a ejecutar cuando quieras: propone tus valores actuales.
# Opciones para pruebas: -SkipDeps (no instala dependencias), -SkipClaude (no toca ~/.claude), -NoStart (no arranca).
# Este archivo es solo ASCII a proposito: Windows PowerShell 5.1 lee mal UTF-8 sin BOM.
param([switch]$SkipDeps, [switch]$SkipClaude, [switch]$NoStart)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $env:APPDATA "perch"
$settingsFile = Join-Path $dataDir "settings.json"
$overlayFile = Join-Path $dataDir "overlay.json"

function Say($t, $c = "Gray") { Write-Host $t -ForegroundColor $c }
function Title($t) { Write-Host ""; Say "== $t ==" Cyan }
function Pause-Exit($code) { Write-Host ""; Read-Host "Pulsa Enter para cerrar" | Out-Null; exit $code }

# Pregunta de opcion unica. $options = lista de textos; devuelve el indice (0-based). Enter = $default.
function Ask-Choice($question, [string[]]$options, [int]$default = 0) {
  Write-Host ""; Say $question White
  for ($i = 0; $i -lt $options.Count; $i++) { Say ("  {0}) {1}{2}" -f ($i + 1), $options[$i], $(if ($i -eq $default) { "   [por defecto]" } else { "" })) }
  while ($true) {
    $a = (Read-Host "Elige 1-$($options.Count)").Trim()
    if ($a -eq "") { return $default }
    $n = 0
    if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) { return $n - 1 }
    Say "  Opcion no valida." Yellow
  }
}
function Ask-Yes($question, [bool]$default = $true) {
  while ($true) {
    $a = (Read-Host "$question [$(if ($default) { 'S/n' } else { 's/N' })]").Trim().ToLower()
    if ($a -eq "") { return $default }
    if ($a -in "s", "si", "y", "yes") { return $true }
    if ($a -in "n", "no") { return $false }
  }
}

# JSON existente -> hashtable ordenada (tolera BOM y archivos rotos).
function Read-Json($file) {
  $h = [ordered]@{}
  if (Test-Path $file) {
    try {
      $o = (Get-Content -Raw -Encoding UTF8 $file).TrimStart([char]0xFEFF) | ConvertFrom-Json
      foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value }
    } catch { Say "  Aviso: no pude leer $file, se reescribira." Yellow }
  }
  return $h
}
function Write-Json($file, $h) {
  New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
  [IO.File]::WriteAllText($file, ($h | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false))) # sin BOM
}

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Run-Perch([string[]]$a) { Push-Location "$root\agent"; try { & bun src/perch.ts @a } finally { Pop-Location } }

# ---------------------------------------------------------------- 1. requisitos
function Check-Requirements {
  Title "1/5  Comprobando requisitos"
  $gitBash = (Test-Path "$env:ProgramFiles\Git\bin\bash.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Git\bin\bash.exe") -or (Test-Path "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")
  $checks = @(
    @{ n = "Bun";                  ok = (Have "bun");  fix = "winget install Oven-sh.Bun" },
    @{ n = "Node.js + npm";        ok = ((Have "node") -and (Have "npm")); fix = "winget install OpenJS.NodeJS.LTS" },
    @{ n = "Git para Windows";     ok = $gitBash;      fix = "winget install Git.Git   (Claude Code ejecuta los hooks con su bash)" },
    @{ n = "curl.exe";             ok = (Test-Path "$env:SystemRoot\System32\curl.exe"); fix = "viene con Windows 10/11; actualiza Windows" },
    @{ n = "Claude Code (claude)"; ok = (Have "claude"); fix = "ver https://docs.claude.com/claude-code" }
  )
  $missing = 0
  foreach ($c in $checks) {
    if ($c.ok) { Say ("  [ok]  {0}" -f $c.n) Green } else { Say ("  [FALTA] {0}  ->  {1}" -f $c.n, $c.fix) Red; $missing++ }
  }
  if (-not (Have "wsh") -and -not (Test-Path "$env:LOCALAPPDATA\waveterm\Data\bin\wsh.exe")) { Say "  [info] Wave Terminal no detectado (solo se necesita si lo usas)." }
  if ($missing -gt 0) {
    Say "`nInstala lo que falta, abre una ventana NUEVA (para que el PATH se actualice) y ejecuta setup.bat otra vez." Yellow
    Pause-Exit 1
  }
}

# ---------------------------------------------------------------- 2. dependencias
function Install-Deps {
  Title "2/5  Instalando dependencias"
  if ($SkipDeps) { Say "  (omitido)"; return }
  Say "  agent: bun install"
  Push-Location "$root\agent"; try { & bun install | Out-Null } finally { Pop-Location }
  Say "  overlay: npm install (puede tardar un minuto: descarga Electron)"
  Push-Location "$root\overlay"
  try {
    & npm install --no-audit --no-fund | Out-Null
    if (-not (Test-Path "node_modules\electron\dist\electron.exe")) { & node node_modules/electron/install.js } # npm 11 omite el postinstall
  } finally { Pop-Location }
  if (-not (Test-Path "$root\overlay\node_modules\electron\dist\electron.exe")) { Say "  No se pudo instalar Electron. Revisa tu conexion y reintenta." Red; Pause-Exit 1 }
  Say "  [ok] dependencias listas" Green
}

# ---------------------------------------------------------------- 3. terminal
function Configure-Terminal {
  Title "3/5  Terminal"
  $s = Read-Json $settingsFile
  $cur = [string]$s["terminal"]
  $names = @("wt", "cmd", "wave", "alacritty", "wezterm", "keep")
  $labels = @(
    "Windows Terminal (wt)",
    "Simbolo del sistema (cmd)",
    "Wave Terminal (copia el comando de reanudar y enfoca Wave)",
    "Alacritty",
    "WezTerm"
  )
  if ($s.Contains("command") -and $cur -eq "custom") { $labels += "Mantener mi terminal personalizada actual" } else { $names = $names[0..4] }
  $def = [Math]::Max(0, [array]::IndexOf($names, $cur)); if ($cur -eq "custom" -and $names.Count -eq 6) { $def = 5 }
  $i = Ask-Choice "Que terminal usas con Claude Code? (se usa para ABRIR sesiones que no estan corriendo)" $labels $def
  switch ($names[$i]) {
    "alacritty" { $s["terminal"] = "custom"; $s["command"] = @("alacritty", "--working-directory", "{cwd}", "-e", "claude", "--resume", "{id}") }
    "wezterm"   { $s["terminal"] = "custom"; $s["command"] = @("wezterm", "start", "--cwd", "{cwd}", "--", "claude", "--resume", "{id}") }
    "keep"      { }
    default     { $s["terminal"] = $names[$i]; $s.Remove("command") }
  }
  $s["focusExisting"] = Ask-Yes "Si la sesion ya esta abierta, llevarte a su ventana en vez de abrir otra copia?" $(if ($s.Contains("focusExisting")) { [bool]$s["focusExisting"] } else { $true })
  if ($names[$i] -eq "wave") {
    Say "`n  Enfocar el bloque exacto de Wave necesita el JWT de Wave. Perch lo guarda SOLO en memoria,"
    Say "  mientras la opcion este activa, y nunca en disco ni en logs (detalles en el README)."
    $s["waveFocusBlock"] = Ask-Yes "Activar el enfoque del bloque exacto en Wave?" $(if ($s.Contains("waveFocusBlock")) { [bool]$s["waveFocusBlock"] } else { $false })
  } else { $s["waveFocusBlock"] = $false }
  Write-Json $settingsFile $s
  Say "  [ok] guardado en $settingsFile" Green
}

# ---------------------------------------------------------------- 4. apariencia
function Configure-Overlay {
  Title "4/5  Apariencia y comportamiento"
  $o = Read-Json $overlayFile
  $edges = "left", "right", "top", "bottom"
  $e = Ask-Choice "En que borde de la pantalla quieres la tira? (luego se puede arrastrar la pestanita)" @("Izquierdo", "Derecho", "Superior", "Inferior") $(if ($o.Contains("edge")) { [Math]::Max(0, [array]::IndexOf($edges, $o["edge"])) } else { 1 })
  $o["edge"] = $edges[$e]
  $scales = 0.75, 1, 1.25, 1.5, 2
  $curScale = if ($o.Contains("scale")) { [Array]::IndexOf($scales, [double]$o["scale"]) } else { 1 }
  $sc = Ask-Choice "Tamano de los iconos:" @("75%", "100%", "125%", "150%", "200%") $(if ($curScale -ge 0) { $curScale } else { 1 })
  $o["scale"] = $scales[$sc]
  $acts = "terminal", "code", "folder"
  $a = Ask-Choice "Que hace un clic sobre una sesion? (el clic derecho siempre ofrece las tres opciones)" @("Abrir/llevar a su terminal", "Abrir su carpeta en VS Code", "Abrir su carpeta en el Explorador") $(if ($o.Contains("clickAction")) { [Math]::Max(0, [array]::IndexOf($acts, $o["clickAction"])) } else { 0 })
  $o["clickAction"] = $acts[$a]
  $n = [ordered]@{}
  if ($o.Contains("notifications") -and $o["notifications"]) { foreach ($p in $o["notifications"].PSObject.Properties) { $n[$p.Name] = $p.Value } }
  $n["enabled"] = Ask-Yes "Mostrar notificaciones de Windows cuando una sesion te necesita o termina?" $(if ($n.Contains("enabled")) { [bool]$n["enabled"] } else { $true })
  $o["notifications"] = $n
  if (-not $o.Contains("visible")) { $o["visible"] = $true }
  Write-Json $overlayFile $o
  Say "  [ok] guardado en $overlayFile" Green
}

# ---------------------------------------------------------------- 5. Claude Code y arranque
function Configure-Integration {
  Title "5/5  Integracion con Claude Code y arranque"
  if ($SkipClaude) { Say "  (omitido)"; return }
  Say "  Perch necesita unos hooks en ~/.claude/settings.json para saber que hace cada sesion."
  Say "  Se hace una copia de seguridad (settings.json.bak-perch-*) antes de cambiar nada."
  if (Ask-Yes "Instalar los hooks?" $true) { Run-Perch "hooks", "install" } else { Say "  Sin hooks Perch no vera sesiones nuevas." Yellow }
  if (Ask-Yes "Arrancar Perch automaticamente cuando abras Claude Code?" $true) { Run-Perch "autostart", "on" } else { Run-Perch "autostart", "off" }
  if (Ask-Yes "Arrancar Perch tambien al iniciar sesion en Windows?" $false) { & "$root\startup.ps1" install | Out-Null; Say "  [ok] atajo creado en Inicio" Green }
  else { & "$root\startup.ps1" remove | Out-Null }
}

function Full-Setup {
  Check-Requirements
  Install-Deps
  Configure-Terminal
  Configure-Overlay
  Configure-Integration
  Title "Listo"
  if (-not $NoStart) {
    if (Ask-Yes "Arrancar Perch ahora (reinicia el agente para aplicar los cambios)?" $true) {
      & "$root\stop.ps1" | Out-Null
      & "$root\start.ps1"
      Say "  Perch esta corriendo: busca el cuadrito naranja en la bandeja del sistema." Green
    }
  }
  Say "`nPara cambiar algo mas adelante vuelve a ejecutar setup.bat (te propone tus valores actuales)."
  Say "Las sesiones de Claude Code que ya estaban abiertas deben reiniciarse para aparecer en Perch."
}

# ---------------------------------------------------------------- menu
function Main-Menu {
  while ($true) {
    Clear-Host
    Say "Perch para Windows" Cyan
    $i = Ask-Choice "Que quieres hacer?" @(
      "Instalar / configurar (asistente completo)",
      "Ver estado",
      "Arrancar Perch",
      "Detener Perch",
      "Desactivar todo (detiene Perch y quita hooks y autoarranque)",
      "Salir") 0
    switch ($i) {
      0 { Full-Setup; Pause-Exit 0 }
      1 { & "$root\perch.ps1" status; Write-Host ""; Read-Host "Enter para volver" | Out-Null }
      2 { & "$root\perch.ps1" start; Read-Host "Enter para volver" | Out-Null }
      3 { & "$root\perch.ps1" stop; Read-Host "Enter para volver" | Out-Null }
      4 { if (Ask-Yes "Seguro? Esto quita los hooks de Claude Code" $false) { & "$root\perch.ps1" disable; & "$root\startup.ps1" remove | Out-Null }; Read-Host "Enter para volver" | Out-Null }
      5 { exit 0 }
    }
  }
}

try {
  # Primera vez (sin configuracion previa): directo al asistente. Despues: menu.
  if (-not (Test-Path $overlayFile) -and -not (Test-Path $settingsFile)) { Say "Perch para Windows - primera configuracion" Cyan; Full-Setup; Pause-Exit 0 }
  else { Main-Menu }
} catch {
  Say "`nError: $($_.Exception.Message)" Red
  Pause-Exit 1
}
