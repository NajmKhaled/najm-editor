param([switch]$ApplySyntheticDemo)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$token=(Get-Content -LiteralPath (Join-Path $repo 'config/session-token') -Raw).Trim()
$headers=@{Authorization='Bearer '+$token}
if($ApplySyntheticDemo){
  $manifest=Get-Content -LiteralPath (Join-Path $repo 'config/v2-build.json') -Raw | ConvertFrom-Json
  $headers['X-Najm-Build']=$manifest.buildId
  Invoke-RestMethod 'http://127.0.0.1:47842/v2/demo' -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 600 | Select-Object structuralCompletion,visualAcceptance,inference,shotCount,sourcePreserved,referencePreserved
}else{Invoke-RestMethod 'http://127.0.0.1:47842/v2/health' -Headers $headers -TimeoutSec 20 | Select-Object engine,directConnected,buildReady,sourceReady}
