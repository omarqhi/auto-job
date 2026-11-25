# Shared n8n settings for the Linux server scripts. Sourced, not run: . scripts/n8n-env.sh
# Same settings as start-n8n.ps1 on Windows. Server-only values (HTTPS address, Claude token) come from ~/.autojob.env.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GENERIC_TIMEZONE="Asia/Karachi"
export TZ="Asia/Karachi"
export N8N_RESTRICT_FILE_ACCESS_TO="$ROOT"   # n8n may only read/write inside this project folder
export NODES_EXCLUDE="[]"                    # re-enable Execute Command (off by default in n8n 2.x)
export N8N_DIAGNOSTICS_ENABLED="false"
export N8N_PERSONALIZATION_ENABLED="false"
export EXECUTIONS_DATA_PRUNE="true"
export EXECUTIONS_DATA_MAX_AGE="720"         # keep 30 days of run history
if [ -f "$HOME/.autojob.env" ]; then set -a; . "$HOME/.autojob.env"; set +a; fi
mkdir -p "$ROOT/logs"
cd "$ROOT"
