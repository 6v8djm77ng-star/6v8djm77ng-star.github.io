# Inventory Count - one-click install & start on Windows (demo mode, no SAP).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Host.UI.RawUI.WindowTitle = 'Inventory Count'

function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Fail($t) {
  Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red
  Write-Host 'Take a screenshot of this window and send it to Claude.' -ForegroundColor Yellow
  Read-Host 'Press Enter to close'; exit 1
}
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

try {
  $root = 'C:\apps\inventory-count'
  $branch = 'claude/busy-knuth-z8wbly'
  $zipUrl = "https://github.com/6v8djm77ng-star/6v8djm77ng-star.github.io/archive/refs/heads/$branch.zip"

  Step '1/5  Checking Node.js'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } else {
      $msi = "$env:TEMP\node-lts.msi"
      Invoke-WebRequest 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi' -OutFile $msi -UseBasicParsing
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /passive" -Wait
    }
    RefreshPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js installation did not complete. Close this window and run the file again.' }
  }
  Write-Host ("Node " + (node -v))

  Step '2/5  Downloading the system'
  New-Item -ItemType Directory -Force 'C:\apps' | Out-Null
  $zip = "$env:TEMP\inventory-count.zip"
  $tmp = "$env:TEMP\inventory-count-src"
  Invoke-WebRequest $zipUrl -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName + '\inventory-count'
  New-Item -ItemType Directory -Force $root | Out-Null
  # copy code; keep existing data/ and .env (never overwrite counting data)
  robocopy $src $root /E /XD data node_modules /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail 'Copying files failed.' }

  Step '3/5  Installing components (a few minutes the first time)'
  Set-Location $root
  npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }

  Step '4/5  Building'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed.' }

  $envFile = "$root\server\.env"
  if (-not (Test-Path $envFile)) {
    "PORT=8080`r`nDB_PATH=./data/inventory.db`r`nBOOTSTRAP_ADMIN_USERNAME=admin`r`nBOOTSTRAP_ADMIN_PIN=1234`r`nSAP_MODE=mock`r`n" | Out-File $envFile -Encoding ascii
  }

  # Desktop shortcut for next time
  $desktop = [Environment]::GetFolderPath('Desktop')
  "@echo off`r`ntitle Inventory Count`r`ncd /d $root\server`r`nstart `"`" cmd /c `"timeout /t 6 >nul & start http://localhost:8080`"`r`nnode dist\index.js`r`npause`r`n" | Out-File "$desktop\Inventory Count.cmd" -Encoding ascii

  Step '5/5  Starting'
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
  Write-Host ''
  Write-Host '  Open in browser:  http://localhost:8080' -ForegroundColor Green
  if ($ip) { Write-Host "  From a tablet:    http://${ip}:8080" -ForegroundColor Green }
  Write-Host '  Login:            admin / 1234' -ForegroundColor Green
  Write-Host '  Keep this window open. Closing it stops the system.' -ForegroundColor Yellow
  Write-Host '  Next time: double-click "Inventory Count" on the desktop.' -ForegroundColor Yellow
  Write-Host ''
  Start-Process cmd -ArgumentList '/c timeout /t 6 >nul & start http://localhost:8080' -WindowStyle Hidden
  Set-Location "$root\server"
  node dist\index.js
  Read-Host 'The system stopped. Press Enter to close'
} catch {
  Fail $_.Exception.Message
}
