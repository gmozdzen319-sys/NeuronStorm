$ErrorActionPreference = 'Stop'
$nodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
$appDirectory = Join-Path $PSScriptRoot 'local-app'
try {
  $response = Invoke-WebRequest 'http://localhost:3000/api/session' -TimeoutSec 2
  if ($response.StatusCode -eq 200 -and $response.Content -match '"account"') { Write-Host 'Neuron Storm jest juz uruchomiony: http://localhost:3000'; exit 0 }
} catch { }
Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appDirectory 'server.log') -RedirectStandardError (Join-Path $appDirectory 'server-error.log')
Write-Host 'Otworz http://localhost:3000 w przegladarce z Pelagus.'
