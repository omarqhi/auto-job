# Applies to the job you picked in the dashboard's job library (queued in applications\_queue\manual-apply.json).
# Started by the dashboard; same steps as the daily run's apply loop. Log: logs\selected-<timestamp>.log
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:GENERIC_TIMEZONE            = "Asia/Karachi"
$env:TZ                          = "Asia/Karachi"
$env:N8N_RESTRICT_FILE_ACCESS_TO = $Root
$env:NODES_EXCLUDE               = "[]"
$env:N8N_RUNNERS_BROKER_PORT     = "5698"     # different from run-now.ps1 (5699) and the server
$log = "$Root\logs\selected-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log"
"log: $log"
n8n.cmd execute --id=AutoJobApplySel1 *> $log
"done"
