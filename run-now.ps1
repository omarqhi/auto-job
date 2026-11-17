# Runs the daily apply workflow once, right now (same as the 9:00 schedule). Log: logs\run-<timestamp>.log
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:GENERIC_TIMEZONE            = "Asia/Karachi"
$env:TZ                          = "Asia/Karachi"
$env:N8N_RESTRICT_FILE_ACCESS_TO = $Root
$env:NODES_EXCLUDE               = "[]"
$env:N8N_RUNNERS_BROKER_PORT     = "5699"     # avoid clashing with the running server's task broker
$log = "$Root\logs\run-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".log"
"Running daily apply workflow... log: $log"
n8n.cmd execute --id=m6fIQatHAJkUlDIP *> $log
"Finished. Tracker:"
node scripts\tracker.js list
