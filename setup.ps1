# First-time setup after downloading Auto Job: installs packages, creates your private config and resume from the examples,
# installs the Claude skills, and builds the n8n workflow files. Safe to run again: it never overwrites your files.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

"== Installing packages"
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed. Is Node.js installed?" }

if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json; "Created config.json: put your name, email, phone and job titles in it." }
if (-not (Test-Path resume\master-resume.md)) { Copy-Item resume\master-resume.example.md resume\master-resume.md; "Created resume\master-resume.md: replace it with your own resume." }

"== Installing Claude skills"
$skills = "$env:USERPROFILE\.claude\skills"
New-Item -ItemType Directory -Force $skills | Out-Null
Get-ChildItem .claude\skills -Directory | ForEach-Object {
  if (Test-Path "$skills\$($_.Name)") { "kept your existing $($_.Name)" }
  else { Copy-Item $_.FullName "$skills\$($_.Name)" -Recurse; "installed $($_.Name)" }
}

"== Building n8n workflow files"
node scripts\build-workflows.js
if ($LASTEXITCODE -ne 0) { throw "Could not build the workflow files." }

""
"Done. Next: open SETUP.md and follow 'One-time setup'."
