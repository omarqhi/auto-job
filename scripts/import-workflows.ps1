# Rebuilds and (re)imports both workflows into n8n. Existing workflows with the same ID are updated in place.
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
node scripts\build-workflows.js
n8n.cmd import:workflow --input=n8n\1-daily-apply.json
n8n.cmd import:workflow --input=n8n\2-reply-watcher.json
n8n.cmd import:workflow --input=n8n\3-apply-selected.json
n8n.cmd import:workflow --input=n8n\4-send-email.json
n8n.cmd list:workflow
