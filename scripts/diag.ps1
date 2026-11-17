# Environment check: shows what is installed on this PC for the Auto Job agent.
$items = [ordered]@{
  'config.json'              = '.\config.json'
  'scripts/tailor.js'        = '.\scripts\tailor.js'
  'local node_modules'       = '.\node_modules\exceljs'
  'tracker xlsx'             = '.\tracker\applications.xlsx'
  'resume preview pdf'       = '.\resume\preview'
  'n8n (global)'             = "$env:APPDATA\npm\n8n.cmd"
  'claude CLI (global)'      = "$env:APPDATA\npm\claude.cmd"
  'n8n data (~/.n8n)'        = "$env:USERPROFILE\.n8n"
  'hiring-panel skill'       = "$env:USERPROFILE\.claude\skills\hiring-panel\SKILL.md"
}
foreach ($k in $items.Keys) { '{0,-22} {1}' -f $k, (Test-Path $items[$k]) }
'n8n version:    ' + (& "$env:APPDATA\npm\n8n.cmd" --version)
'claude version: ' + (& "$env:APPDATA\npm\claude.cmd" --version)
'claude auth:    ' + (& "$env:APPDATA\npm\claude.cmd" auth status 2>&1 | Out-String).Trim()
