@echo off
chcp 65001 >nul
title Inventory Count - Install
echo Downloading installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f=\"$env:TEMP\install-inventory.ps1\"; Invoke-WebRequest 'https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/busy-knuth-z8wbly/inventory-count/scripts/install-windows.ps1' -OutFile $f -UseBasicParsing; & $f"
if errorlevel 1 pause
