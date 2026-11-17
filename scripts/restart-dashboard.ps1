# Restarts only the dashboard server (after dashboard code changes). Use update-live.ps1 when workflows changed too.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$c = Get-NetTCPConnection -LocalPort 5680 -State Listen -ErrorAction SilentlyContinue
if ($c) { Stop-Process -Id $c.OwningProcess -Force; Start-Sleep 1 }
powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\start-dashboard.ps1"
Start-Sleep 2
curl.exe -s -o NUL -w "dashboard http %{http_code}`n" http://localhost:5680/
