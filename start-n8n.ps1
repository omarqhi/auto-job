# Starts n8n for the Auto Job agent. Runs at Windows logon via the Startup-folder shortcut.
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:GENERIC_TIMEZONE            = "Asia/Karachi"
$env:TZ                          = "Asia/Karachi"
$env:N8N_RESTRICT_FILE_ACCESS_TO = $Root          # n8n may only read/write inside this project folder
$env:NODES_EXCLUDE               = "[]"           # re-enable Execute Command (off by default in n8n 2.x)
$env:N8N_DIAGNOSTICS_ENABLED     = "false"
$env:N8N_PERSONALIZATION_ENABLED = "false"
$env:EXECUTIONS_DATA_PRUNE       = "true"
$env:EXECUTIONS_DATA_MAX_AGE     = "720"          # keep 30 days of run history

New-Item -ItemType Directory -Force "$Root\logs" | Out-Null
Set-Location $Root
n8n start *>> "$Root\logs\n8n.log"
