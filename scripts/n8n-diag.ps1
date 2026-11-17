# Deeper n8n startup diagnostics: process age/CPU, who holds ports 5678/5679, sqlite lock files.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'n8n' } | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  "pid {0} parent {1} started {2} cpu {3}s  {4}" -f $_.ProcessId, $_.ParentProcessId, $p.StartTime, [int]$p.CPU, $_.CommandLine.Substring(0, [Math]::Min(110, $_.CommandLine.Length))
}
foreach ($port in 5678, 5679) {
  $c = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 3
  if ($c) { $c | ForEach-Object { "port {0}: {1} pid {2} ({3})" -f $port, $_.State, $_.OwningProcess, (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name } } else { "port ${port}: free" }
}
Get-ChildItem "$env:USERPROFILE\.n8n" -Filter "database.sqlite*" | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
try { "healthz: " + (Invoke-WebRequest http://localhost:5678/healthz -UseBasicParsing -TimeoutSec 5).Content } catch { "healthz: no response" }
