# Applies code changes to the running system: re-imports the n8n workflows and restarts the dashboard server.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

"== Re-importing workflows"
powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\scripts\import-workflows.ps1"

"== Restarting dashboard"
$c = Get-NetTCPConnection -LocalPort 5680 -State Listen -ErrorAction SilentlyContinue
if ($c) { Stop-Process -Id $c.OwningProcess -Force; Start-Sleep 1 }
powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\start-dashboard.ps1"
Start-Sleep 3
"== Dashboard status"
curl.exe -s http://localhost:5680/api/stats
""
"done"
