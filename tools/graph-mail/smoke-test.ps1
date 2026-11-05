# Graph mail smoke test. Installs graphTransport.cjs to C:\apps\_shared (hash-verified)
# and sends ONE test mail through Microsoft Graph. Touches no app and no .env.
# Asks for the three values from the Entra app registration; the secret is read
# hidden and kept only in this PowerShell session's memory.
# Run in PowerShell on the server:
#   irm https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/graph-mail/smoke-test.ps1 | iex

& {
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base  = 'https://raw.githubusercontent.com/6v8djm77ng-star/6v8djm77ng-star.github.io/claude/upbeat-cray-h52mmj/tools/graph-mail'
$Hash  = '882391DD41F4CF575B5BFC6B4C2BE6271F892DFB2966592A33FD09F85C04D55E'
$Dir   = 'C:\apps\_shared'
$Node  = 'C:\apps\runtime\node\node.exe'

if (-not (Test-Path $Node)) { throw "Node not found at $Node" }
New-Item -ItemType Directory -Force $Dir | Out-Null
$dst = Join-Path $Dir 'graphTransport.cjs'
$tmp = Join-Path $env:TEMP 'graphTransport.cjs'
Invoke-WebRequest "$Base/graphTransport.cjs" -UseBasicParsing -OutFile $tmp
$h = (Get-FileHash $tmp -Algorithm SHA256).Hash
if ($h -ne $Hash) { Remove-Item $tmp; throw "graphTransport.cjs hash mismatch ($h)" }
Move-Item $tmp $dst -Force
Write-Host "graphTransport.cjs installed and verified: $dst" -ForegroundColor Green

# Non-secret values can be preset in the same command line ($env:GRAPH_TENANT_ID=...; ...),
# so the only prompt left is the secret itself.
$tenant = if ($env:GRAPH_TENANT_ID) { $env:GRAPH_TENANT_ID } else { Read-Host 'Tenant ID' }
$client = if ($env:GRAPH_CLIENT_ID) { $env:GRAPH_CLIENT_ID } else { Read-Host 'Client ID' }
$sender = if ($env:GRAPH_SENDER) { $env:GRAPH_SENDER } else { 'izik@oig.co.il' }
$to     = if ($env:SMOKE_TO) { $env:SMOKE_TO } else { $sender }
foreach ($a in $sender, $to) { if ($a -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "Not an email address: '$a'" } }
Write-Host "tenant $tenant | app $client | from $sender | to $to"
$sec    = Read-Host 'Paste the secret VALUE (right-click), then Enter' -AsSecureString

$plain = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))).Trim()
# A Secret ID is a GUID; the secret Value is ~40 chars and usually contains '~'.
if ($plain -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') { throw 'You entered the Secret ID (a GUID). Enter the secret VALUE instead.' }
if ($plain.Length -lt 3) { throw 'The secret came in empty - paste with right-click, then press Enter.' }
Write-Host ("secret entered: starts with '{0}', length {1} (a Value is usually 40 chars)" -f $plain.Substring(0,3), $plain.Length)
$env:GRAPH_TENANT_ID = $tenant.Trim()
$env:GRAPH_CLIENT_ID = $client.Trim()
$env:GRAPH_CLIENT_SECRET = $plain
$env:GRAPH_SENDER = $sender
$env:SMOKE_TO = $to

$js = @'
const t = require(process.argv[2]).createGraphTransport();
(async () => {
  await t.verify(); console.log('token: OK');
  const i = await t.sendMail({ to: process.env.SMOKE_TO, subject: 'OIG Graph mail test ' + new Date().toISOString(),
    html: '<p dir="rtl">בדיקת שליחה דרך Microsoft 365 מהשרת. אם המייל הגיע - החיבור עובד.</p>' });
  console.log('send: ' + i.response + ' -> ' + i.accepted.join(', '));
})().catch((e) => { console.error('FAILED: ' + e.message); process.exitCode = 1; });
'@
# Run from a file: Windows PowerShell mangles embedded quotes in native -e arguments.
$jsFile = Join-Path $env:TEMP 'graph-smoke.cjs'
[IO.File]::WriteAllText($jsFile, $js, (New-Object System.Text.UTF8Encoding $false))
try {
  & $Node $jsFile $dst
  if ($LASTEXITCODE -eq 0) { Write-Host "`nSent. Check the inbox of $to (and Sent Items of $sender)." -ForegroundColor Green }
} finally {
  Remove-Item $jsFile -ErrorAction SilentlyContinue
  Remove-Item Env:GRAPH_CLIENT_SECRET, Env:GRAPH_TENANT_ID, Env:GRAPH_CLIENT_ID, Env:GRAPH_SENDER, Env:SMOKE_TO -ErrorAction SilentlyContinue
}
}
