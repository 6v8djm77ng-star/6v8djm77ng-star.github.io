# Inventory Count - run in background as a Windows service-like task, expose over Tailscale, add user "moti".
# Prerequisite: run-windows.ps1 already installed the app to C:\apps\inventory-count-app.
# Run in PowerShell as Administrator. Idempotent: safe to run again.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

$app      = 'C:\apps\inventory-count-app'
$server   = "$app\server"
$taskName = 'InventoryCount'
$port     = 8080
$base     = "http://localhost:$port"

try {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { Fail 'Run PowerShell as Administrator (right-click > Run as administrator).' }
  if (-not (Test-Path "$server\dist\index.js")) { Fail "App not found at $app. Run run-windows.ps1 first." }
  RefreshPath
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Fail 'Node.js not found. Run run-windows.ps1 first.' }

  Step '1/5  Stopping the foreground instance (if running)'
  $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $listen) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Write-Host "Stopped node PID $($p.Id)" }
    elseif ($p) { Fail "Port $port is used by $($p.ProcessName) (PID $($p.Id)). Free it and run again." }
  }
  Start-Sleep -Seconds 2

  Step '2/5  Registering background task (starts with Windows, restarts on crash)'
  New-Item -ItemType Directory -Force "$app\logs" | Out-Null
  $runner = "$app\run-server.cmd"
  "@echo off`r`ncd /d `"$server`"`r`n`"$node`" dist\index.js >> `"$app\logs\server.log`" 2>&1`r`n" | Out-File $runner -Encoding ascii
  $action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`"" -WorkingDirectory $server
  $trigger   = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
               -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName

  # Desktop shortcut now only opens the browser (starting a 2nd server would fail on the port)
  $desktop = [Environment]::GetFolderPath('Desktop')
  "@echo off`r`nstart http://localhost:$port`r`n" | Out-File "$desktop\Inventory Count.cmd" -Encoding ascii

  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    try { $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; if ($h.ok) { $ok = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ok) { Fail "Server did not come up. See $app\logs\server.log" }
  Write-Host "Server is up: $base  (SAP mode: $($h.sapMode))" -ForegroundColor Green

  Step '3/5  Installing Tailscale'
  $ts = 'C:\Program Files\Tailscale\tailscale.exe'
  if (-not (Test-Path $ts)) {
    winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
    for ($i = 0; $i -lt 30 -and -not (Test-Path $ts); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Path $ts)) { Fail 'Tailscale installation did not complete.' }
  }

  Step '4/5  Connecting to Tailscale - a browser will open, log in with YOUR account'
  & $ts up --unattended
  $tsIp = (& $ts ip -4 | Select-Object -First 1).Trim()
  if ($tsIp -notmatch '^100\.') { Fail 'Tailscale is not connected (no 100.x address).' }
  # allow port 8080 only from the tailnet range
  Get-NetFirewallRule -DisplayName 'Inventory Count (Tailscale)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'Inventory Count (Tailscale)' -Direction Inbound -Protocol TCP -LocalPort $port `
    -RemoteAddress '100.64.0.0/10' -Action Allow -Profile Any | Out-Null

  Step '5/5  Creating manager user "moti"'
  $adminUser = Read-Host 'Admin username [admin]'; if (-not $adminUser) { $adminUser = 'admin' }
  $adminPin  = Read-Host 'Admin PIN' -AsSecureString
  $motiPin   = Read-Host 'New PIN for moti (4-8 digits)' -AsSecureString
  $plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
  $send = {
    param($method, $path, $obj)
    $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
    Invoke-RestMethod -Method $method -Uri "$base$path" -Body $bytes -ContentType 'application/json; charset=utf-8' -WebSession $script:web
  }
  $script:web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  try { & $send Post '/api/auth/login' @{ username = $adminUser; pin = (& $plain $adminPin) } | Out-Null }
  catch { Fail "Admin login failed: $($_.ErrorDetails.Message)" }
  $existing = (Invoke-RestMethod "$base/api/users" -WebSession $script:web).users | Where-Object { $_.username -eq 'moti' }
  if ($existing) {
    Write-Host "User moti already exists (role: $($existing.role)). Not changed." -ForegroundColor Yellow
  } else {
    $display = -join ([char]0x05DE, [char]0x05D5, [char]0x05D8, [char]0x05D9)   # Moti in Hebrew
    try { $r = & $send Post '/api/users' @{ username = 'moti'; displayName = $display; role = 'manager'; pin = (& $plain $motiPin) } }
    catch { Fail "Creating moti failed: $($_.ErrorDetails.Message)" }
    Write-Host "Created user moti (role: $($r.user.role))" -ForegroundColor Green
  }

  Write-Host ''
  Write-Host '================ DONE ================' -ForegroundColor Green
  Write-Host "  Local:      $base"
  Write-Host "  Tailscale:  http://${tsIp}:$port" -ForegroundColor Green
  Write-Host "  Logs:       $app\logs\server.log"
  Write-Host "  Task:       '$taskName' (Task Scheduler) - starts with Windows, survives closing windows/logoff"
  Write-Host '  Remember: change the admin PIN if it is still 1234.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'
} catch {
  Fail $_.Exception.Message
}
