#!/usr/bin/env bash
# Linux server version of send-email.ps1: sends the email queued by the dashboard's "Send now" through n8n's Gmail.
. "$(dirname "$0")/scripts/n8n-env.sh"
export N8N_RUNNERS_BROKER_PORT="5697"   # different from run-now.sh (5699), apply-selected.sh (5698) and the server
log="$ROOT/logs/send-$(date +%Y%m%d-%H%M%S).log"
echo "log: $log"
n8n execute --id=AutoJobSendMail1 > "$log" 2>&1
echo "done"
