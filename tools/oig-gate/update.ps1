# OIG Gate updater. Replaces ONLY gate.js with the latest verified version and
# restarts the gate. Leaves gate-config.json, gate-state.json and gate-secret.key
# untouched (enrolled devices and settings are preserved). Funnel is not changed.
# Run in PowerShell as Administrator on the SAP server:
#   irm https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/oig-gate/update.ps1 | iex

& {
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base     = 'https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/oig-gate'
$GateHash = 'FF634D7C5EB6CE1D72F77273C387C4FF8DE86CB580C460D04F37EA9653FCA26E'
$Dir      = 'C:\apps\oig-gate'
$Node     = 'C:\apps\runtime\node\node.exe'
$Task     = 'OIG Gate'
$Ports    = 4801, 4802, 4803, 4804

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nSTOPPED: $m" -ForegroundColor Red; throw $m }
function Status($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8).StatusCode } catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } } }

Step 'Prechecks'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'Run PowerShell as Administrator' }
if (-not (Test-Path (Join-Path $Dir 'gate.js'))) { Fail "No gate at $Dir - run install.ps1 first" }

Step 'Download and verify new gate.js'
$tmp = Join-Path $env:TEMP 'oig-gate-new.js'
Invoke-WebRequest "$Base/gate.js" -UseBasicParsing -OutFile $tmp
$h = (Get-FileHash $tmp -Algorithm SHA256).Hash
if ($h -ne $GateHash) { Remove-Item $tmp; Fail "gate.js hash mismatch ($h)" }
Write-Host 'gate.js verified'

Step 'Back up current gate.js and swap in the new one'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item (Join-Path $Dir 'gate.js') (Join-Path $Dir "gate.js.bak-$stamp") -Force
Move-Item $tmp (Join-Path $Dir 'gate.js') -Force

Step 'Restart the gate'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'oig-gate' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
Start-ScheduledTask -TaskName $Task
Start-Sleep 3

Step 'Verify all listeners block (404)'
$bad = @()
foreach ($p in $Ports) { $c = Status "http://127.0.0.1:$p/"; if ($c -ne 404) { $bad += "$p=$c" } }
if ($bad.Count) {
  Write-Host "Rolling back gate.js" -ForegroundColor Yellow
  Copy-Item (Join-Path $Dir "gate.js.bak-$stamp") (Join-Path $Dir 'gate.js') -Force
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'oig-gate' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2; Start-ScheduledTask -TaskName $Task
  Fail "Listeners not healthy after update ($($bad -join ', ')). Rolled back to previous gate.js."
}
Write-Host 'All four listeners healthy (404).' -ForegroundColor Green
Write-Host "`nUpdate done. New commands available: 'gate.js link <label> <apps>' and 'gate.js apps <id> <apps|all>'."
& $Node (Join-Path $Dir 'gate.js') list
}
