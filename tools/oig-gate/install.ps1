# OIG Gate installer. Run in PowerShell as Administrator on the SAP server:
#   irm https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/oig-gate/install.ps1 | iex
#
# What it does:
#   1. Downloads gate.js, verifies its SHA-256, installs to C:\apps\oig-gate
#   2. Registers the "OIG Gate" scheduled task (starts at boot, restarts on failure)
#   3. Backs up Tailscale serve config, moves Funnel :8443 and :443/ behind the gate
#   4. Verifies the result; rolls back automatically on any mismatch
#   5. Prints one-time enrollment links for iphone and laptop

& {
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base     = 'https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/oig-gate'
$GateHash = 'FF634D7C5EB6CE1D72F77273C387C4FF8DE86CB580C460D04F37EA9653FCA26E'
$Dir      = 'C:\apps\oig-gate'
$Node     = 'C:\apps\runtime\node\node.exe'
$Task     = 'OIG Gate'
$Gates    = @{ 8443 = 'http://127.0.0.1:4801'; 443 = 'http://127.0.0.1:4802' }

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nSTOPPED: $m" -ForegroundColor Red; throw $m }

function Get-ServeConfig { (& tailscale serve status --json | Out-String) | ConvertFrom-Json }
function Get-Proxy($cfg, $hostPort, $path) {
  $w = $cfg.Web.PSObject.Properties[$hostPort]; if (-not $w) { return $null }
  $h = $w.Value.Handlers.PSObject.Properties[$path]; if ($h) { return $h.Value.Proxy }
  return $null
}
function Get-Handlers($cfg, $hostPort) {
  $out = @{}
  $w = $cfg.Web.PSObject.Properties[$hostPort]
  if ($w) { foreach ($p in $w.Value.Handlers.PSObject.Properties) { $out[$p.Name] = $p.Value.Proxy } }
  return $out
}
function Test-Funnel($cfg, $hostPort) {
  $f = $cfg.AllowFunnel.PSObject.Properties[$hostPort]
  return ($f -and $f.Value -eq $true)
}
function Get-Status($url) {
  try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10).StatusCode }
  catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
}
function Set-FunnelTarget($port, $target) {
  if ($port -eq 443) {
    & tailscale funnel --https=443 --set-path=/ off | Out-Host
    & tailscale funnel --bg --https=443 --set-path=/ $target | Out-Host
  } else {
    & tailscale funnel --https=$port off | Out-Host
    & tailscale funnel --bg --https=$port $target | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { throw "tailscale funnel failed for port $port" }
}

# ---------- 1. prechecks ----------
Step 'Prechecks'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'Run PowerShell as Administrator' }
if (-not (Test-Path $Node)) { Fail "Node not found at $Node" }
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { Fail 'tailscale CLI not found' }
& $Node --version | Out-Host

$TsHost = ((& tailscale status --json | Out-String) | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
if (-not $TsHost) { Fail 'Could not read Tailscale hostname' }
Write-Host "Tailscale host: $TsHost"

$existing = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
if ($existing) { Write-Host 'Existing OIG Gate task found - stopping it for reinstall'; Stop-ScheduledTask -TaskName $Task; Start-Sleep 2 }
foreach ($p in 4801, 4802) {
  if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { Fail "Port $p is already in use" }
}

# ---------- 2. install gate.js ----------
Step 'Download and verify gate.js'
New-Item -ItemType Directory -Force $Dir | Out-Null
$tmp = Join-Path $env:TEMP 'oig-gate.js'
Invoke-WebRequest "$Base/gate.js" -UseBasicParsing -OutFile $tmp
$h = (Get-FileHash $tmp -Algorithm SHA256).Hash
if ($h -ne $GateHash) { Remove-Item $tmp; Fail "gate.js hash mismatch ($h)" }
Move-Item $tmp (Join-Path $Dir 'gate.js') -Force
Write-Host 'gate.js OK'

Step 'Initialize'
Push-Location $Dir
try { & $Node gate.js init --host $TsHost | Out-Host } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Fail 'gate.js init failed' }

# ---------- 3. scheduled task ----------
Step 'Register scheduled task'
$a = New-ScheduledTaskAction -Execute $Node -Argument "`"$Dir\gate.js`" serve" -WorkingDirectory $Dir
$t = New-ScheduledTaskTrigger -AtStartup
$s = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $Task -Action $a -Trigger $t -Settings $s -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $Task
Start-Sleep 3
foreach ($p in 4801, 4802) {
  $code = Get-Status "http://127.0.0.1:$p/"
  if ($code -ne 404) { Fail "Gate on port $p is not responding as expected (got $code). Funnel NOT changed." }
}
Write-Host 'Gate running and blocking (404) on 4801 and 4802'

# ---------- 4. move Funnel behind the gate ----------
Step 'Back up Tailscale serve config'
$before = Get-ServeConfig
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
(& tailscale serve status --json | Out-String) | Set-Content -Encoding UTF8 (Join-Path $Dir "serve-before-gate-$stamp.json")

$orig = @{}
foreach ($port in $Gates.Keys) {
  $hp = "${TsHost}:$port"
  $orig[$port] = Get-Proxy $before $hp '/'
  if (-not $orig[$port]) { Fail "No handler at $hp / - config differs from what we mapped. Funnel NOT changed." }
  if (-not (Test-Funnel $before $hp)) { Fail "$hp is not on Funnel - config differs from what we mapped. Funnel NOT changed." }
}
if ($orig[8443] -eq $Gates[8443] -and $orig[443] -eq $Gates[443]) {
  Write-Host 'Funnel already points to the gate - skipping switch'
} else {
  @{ host = $TsHost; port8443 = $orig[8443]; port443 = $orig[443] } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Dir 'rollback.json')
  $others443 = Get-Handlers $before "${TsHost}:443"; $others443.Remove('/')

  Step 'Switch Funnel to the gate'
  $okSwitch = $true
  try {
    foreach ($port in 8443, 443) { Set-FunnelTarget $port $Gates[$port] }
    $after = Get-ServeConfig
    foreach ($port in 8443, 443) {
      $hp = "${TsHost}:$port"
      if ((Get-Proxy $after $hp '/') -ne $Gates[$port]) { $okSwitch = $false; Write-Host "Mismatch: $hp / -> $(Get-Proxy $after $hp '/')" }
      if (-not (Test-Funnel $after $hp)) { $okSwitch = $false; Write-Host "Mismatch: $hp lost Funnel" }
    }
    $now443 = Get-Handlers $after "${TsHost}:443"
    foreach ($k in $others443.Keys) {
      if ($now443[$k] -ne $others443[$k]) { $okSwitch = $false; Write-Host "Mismatch: :443 $k -> $($now443[$k]) (was $($others443[$k]))" }
    }
  } catch { $okSwitch = $false; Write-Host $_ }

  if (-not $okSwitch) {
    Step 'ROLLING BACK Funnel to original targets'
    foreach ($port in 8443, 443) { try { Set-FunnelTarget $port $orig[$port] } catch { Write-Host $_ } }
    & tailscale serve status | Out-Host
    Fail 'Funnel switch did not verify; original targets restored. Send this output to Claude.'
  }
  Write-Host 'Funnel now goes through the gate. /q, /refurb, /api/public and :10000 unchanged.'
}
& tailscale serve status | Out-Host

# ---------- 5. enrollment links ----------
Step 'One-time links (valid 30 min, single use). Open each ONE in Safari / Edge on the right device:'
Push-Location $Dir
try {
  foreach ($d in 'iphone', 'laptop') {
    $link = (& $Node gate.js link $d | Select-Object -Last 1)
    Write-Host "`n  $d :" -ForegroundColor Yellow
    Write-Host "  $link" -ForegroundColor Green
  }
} finally { Pop-Location }

Write-Host "`nDONE. After opening a link, tap 'Face ID' registration (available for 15 minutes)." -ForegroundColor Cyan
Write-Host "Rollback any time:  irm $Base/rollback.ps1 | iex"
}
