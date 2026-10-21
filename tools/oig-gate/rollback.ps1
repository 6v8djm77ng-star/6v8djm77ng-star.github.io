# OIG Gate rollback. Restores Funnel :8443 and :443/ to their pre-gate targets and stops the gate.
# Run in PowerShell as Administrator on the SAP server:
#   irm https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/oig-gate/rollback.ps1 | iex
# Files in C:\apps\oig-gate are kept; reinstalling reuses enrolled devices.

& {
$ErrorActionPreference = 'Stop'
$Dir = 'C:\apps\oig-gate'
$rb = Join-Path $Dir 'rollback.json'
if (-not (Test-Path $rb)) { Write-Host "No $rb - nothing to roll back" -ForegroundColor Red; return }
$r = Get-Content $rb -Raw | ConvertFrom-Json

& tailscale funnel --https=8443 off | Out-Host
& tailscale funnel --bg --https=8443 $r.port8443 | Out-Host
& tailscale funnel --https=443 --set-path=/ off | Out-Host
& tailscale funnel --bg --https=443 --set-path=/ $r.port443 | Out-Host

Stop-ScheduledTask -TaskName 'OIG Gate' -ErrorAction SilentlyContinue
Disable-ScheduledTask -TaskName 'OIG Gate' -ErrorAction SilentlyContinue | Out-Null

& tailscale serve status | Out-Host
Write-Host "`nRolled back: :8443 -> $($r.port8443), :443/ -> $($r.port443). Gate stopped and disabled." -ForegroundColor Yellow
}
