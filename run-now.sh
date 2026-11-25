#!/usr/bin/env bash
# Linux server version of run-now.ps1: runs the daily apply workflow once, right now. Log: logs/run-<timestamp>.log
. "$(dirname "$0")/scripts/n8n-env.sh"
export N8N_RUNNERS_BROKER_PORT="5699"   # avoid clashing with the running server's task broker
log="$ROOT/logs/run-$(date +%Y%m%d-%H%M).log"
echo "Running daily apply workflow... log: $log"
n8n execute --id=m6fIQatHAJkUlDIP > "$log" 2>&1
echo "Finished. Tracker:"
node scripts/tracker.js list
