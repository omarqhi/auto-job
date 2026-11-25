#!/usr/bin/env bash
# Linux server version of start-n8n.ps1. Run by the autojob-n8n service (server/install.sh sets it up).
. "$(dirname "$0")/scripts/n8n-env.sh"
exec n8n start
