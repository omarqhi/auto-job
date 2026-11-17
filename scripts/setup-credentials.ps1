# Imports the two Google credential shells (Client ID only; you add the secret + sign in in n8n)
# and lists credential IDs/names so the workflows can be linked to them.
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
if (Test-Path n8n\google-credentials.json) { n8n.cmd import:credentials --input=n8n\google-credentials.json }   # optional: a fresh install makes the credentials in n8n by hand
n8n.cmd export:credentials --all --output=n8n\_creds-export.json
node -e "const c=require('./n8n/_creds-export.json'); require('fs').writeFileSync('n8n/credential-ids.json', JSON.stringify(c.map(x=>({id:x.id,name:x.name,type:x.type})),null,2)); console.log(JSON.stringify(c.map(x=>({id:x.id,name:x.name,type:x.type}))))"
Remove-Item n8n\_creds-export.json
