#!/usr/bin/env bash
# Linux server version of setup-credentials.ps1: records the IDs of the n8n credentials you made,
# so the workflows are linked to them. Run again whenever you add or rename a credential.
. "$(dirname "$0")/n8n-env.sh"
n8n export:credentials --all --output=n8n/_creds-export.json
node -e "const c=require('./n8n/_creds-export.json'); require('fs').writeFileSync('n8n/credential-ids.json', JSON.stringify(c.map(x=>({id:x.id,name:x.name,type:x.type})),null,2)); console.log(c.map(x=>x.name+' ('+x.type+')').join('\n'))"
rm -f n8n/_creds-export.json
