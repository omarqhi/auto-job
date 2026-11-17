# Opens the Auto Job dashboard. Starts the dashboard server and n8n in the background if they aren't running.
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
New-Item -ItemType Directory -Force "$Root\logs" | Out-Null

function Test-Port($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

if (-not (Test-Port 5680)) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "`"$Root\dashboard\server.js`"" `
    -RedirectStandardOutput "$Root\logs\dashboard.log" -RedirectStandardError "$Root\logs\dashboard-error.log"
}
if (-not (Test-Port 5678)) {
  Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Root\start-n8n.ps1`""
}
for ($i = 0; $i -lt 20 -and -not (Test-Port 5680); $i++) { Start-Sleep -Milliseconds 500 }
Start-Process "http://localhost:5680"
