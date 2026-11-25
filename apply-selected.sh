#!/usr/bin/env bash
# Linux server version of apply-selected.ps1: applies to the job picked in the dashboard's job library.
. "$(dirname "$0")/scripts/n8n-env.sh"
export N8N_RUNNERS_BROKER_PORT="5698"   # different from run-now.sh (5699) and the server
log="$ROOT/logs/selected-$(date +%Y%m%d-%H%M%S).log"
echo "log: $log"
n8n execute --id=AutoJobApplySel1 > "$log" 2>&1
echo "done"
