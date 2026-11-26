# Inventory Count - run on Windows from a prebuilt package (no npm, no build). Demo mode.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Fail($t) {
  Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red
  Write-Host 'Take a screenshot of this window and send it to Claude.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'; return
}
try {
  $app = 'C:\apps\inventory-count-app'
  $zipUrl = 'https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/busy-knuth-z8wbly/inventory-count/release/inventory-count-win.zip'

  Step '1/4  Checking Node.js'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  }
  Write-Host ("Node " + (node -v))

  Step '2/4  Downloading the system (30 MB)'
  $zip = "$env:TEMP\inventory-count-win.zip"
  $tmp = "$env:TEMP\inventory-count-win"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest $zipUrl -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force

  Step '3/4  Installing'
  New-Item -ItemType Directory -Force $app | Out-Null
  # keep counting data and settings on updates
  robocopy "$tmp\inventory-count" $app /E /XD data /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail 'Copying files failed.'; return }
  $envFile = "$app\server\.env"
  if (-not (Test-Path $envFile)) {
    "PORT=8080`r`nDB_PATH=./data/inventory.db`r`nBOOTSTRAP_ADMIN_USERNAME=admin`r`nBOOTSTRAP_ADMIN_PIN=1234`r`nSAP_MODE=mock`r`n" | Out-File $envFile -Encoding ascii
  }
  $desktop = [Environment]::GetFolderPath('Desktop')
  "@echo off`r`ntitle Inventory Count - keep this window open`r`ncd /d $app\server`r`nstart `"`" cmd /c `"timeout /t 5 >nul & start http://localhost:8080`"`r`nnode dist\index.js`r`npause`r`n" | Out-File "$desktop\Inventory Count.cmd" -Encoding ascii

  Step '4/4  Starting'
  Write-Host ''
  Write-Host '  Browser: http://localhost:8080   Login: admin / 1234' -ForegroundColor Green
  Write-Host '  KEEP THIS WINDOW OPEN. Closing it stops the system.' -ForegroundColor Yellow
  Write-Host '  Next time: double-click "Inventory Count" on the desktop.' -ForegroundColor Yellow
  Write-Host ''
  Start-Process cmd -ArgumentList '/c timeout /t 5 >nul & start http://localhost:8080' -WindowStyle Hidden
  Set-Location "$app\server"
  $ErrorActionPreference = 'Continue'
  node dist\index.js
} catch {
  Fail $_.Exception.Message
}
