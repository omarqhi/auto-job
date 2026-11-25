#!/usr/bin/env bash
# Linux server version of import-workflows.ps1: rebuilds and (re)imports the four workflows into n8n.
. "$(dirname "$0")/n8n-env.sh"
node scripts/build-workflows.js
for f in 1-daily-apply 2-reply-watcher 3-apply-selected 4-send-email; do
  n8n import:workflow --input="n8n/$f.json"
done
n8n list:workflow
