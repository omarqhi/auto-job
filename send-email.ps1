# Sends the email queued by the dashboard's "Send now" (applications\_queue\send-email.json) through n8n's Gmail.
# Started by the dashboard. Log: logs\send-<timestamp>.log
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:GENERIC_TIMEZONE            = "Asia/Karachi"
$env:TZ                          = "Asia/Karachi"
$env:N8N_RESTRICT_FILE_ACCESS_TO = $Root
$env:NODES_EXCLUDE               = "[]"
$env:N8N_RUNNERS_BROKER_PORT     = "5697"     # different from run-now.ps1 (5699), apply-selected.ps1 (5698) and the server
$log = "$Root\logs\send-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log"
"log: $log"
n8n.cmd execute --id=AutoJobSendMail1 *> $log
"done"
