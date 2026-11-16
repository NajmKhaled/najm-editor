param([string]$PythonExecutable,[switch]$EnableUnsignedCepTestMode)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repo
npm run build
if($LASTEXITCODE -ne 0){throw 'Build failed; panel was not installed.'}
if($PythonExecutable){
  if($PythonExecutable -notmatch '^(?:[A-Za-z]:\\|\\\\)' -or [System.IO.Path]::GetFileName($PythonExecutable) -ine 'python.exe' -or !(Test-Path -LiteralPath $PythonExecutable -PathType Leaf)){throw 'Pin an existing absolute interpreter path.'}
  New-Item -ItemType Directory -Path config -Force | Out-Null
  $settings=[pscustomobject]@{pythonExecutable=$PythonExecutable;whisperModel='medium'}
  if(Test-Path -LiteralPath 'config/settings.json'){$settings=Get-Content -LiteralPath 'config/settings.json' -Raw | ConvertFrom-Json;$settings | Add-Member -NotePropertyName pythonExecutable -NotePropertyValue $PythonExecutable -Force}
  [System.IO.File]::WriteAllText((Join-Path $repo 'config/settings.json'),($settings | ConvertTo-Json),(New-Object System.Text.UTF8Encoding($false)))
}
node scripts/bootstrap-local.mjs
if($LASTEXITCODE -ne 0){throw 'Credential bootstrap failed.'}
$panel=Join-Path $env:APPDATA 'Adobe/CEP/extensions/com.najm.editor.preview'
New-Item -ItemType Directory -Path $panel -Force | Out-Null
$panelFiles=@('CSXS/manifest.xml','index.html','style.css','app.js','host.jsx')
foreach($relative in $panelFiles){$to=Join-Path $panel $relative;New-Item -ItemType Directory -Path (Split-Path $to -Parent) -Force | Out-Null;Copy-Item -LiteralPath (Join-Path $repo ('apps/premiere-panel-v2/'+$relative)) -Destination $to -Force}
# Fingerprint all runtime code, scripts and tools. Never include local config/credentials.
$buildFiles=@($panelFiles | ForEach-Object {'apps/premiere-panel-v2/'+$_})
foreach($directory in @('dist/services/v2','dist/packages/v2','dist/packages/pipeline','dist/demo','tools','scripts')){
  $buildFiles+=@(Get-ChildItem -LiteralPath (Join-Path $repo $directory) -File -Recurse | Where-Object {$_.Extension -in '.js','.mjs','.py','.ps1'} | ForEach-Object {$_.FullName.Substring($repo.Length+1).Replace('\','/')})
}
$hashes=@{};foreach($file in $buildFiles){$hashes[$file]=(Get-FileHash -LiteralPath (Join-Path $repo $file) -Algorithm SHA256).Hash.ToLowerInvariant()}
$identity=($buildFiles | Sort-Object | ForEach-Object {$_+'='+$hashes[$_]}) -join "`n"
$sha=[System.Security.Cryptography.SHA256]::Create();try{$buildId=([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($identity)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
[System.IO.File]::WriteAllText((Join-Path $repo 'config/v2-build.json'),(@{buildId=$buildId;files=$hashes} | ConvertTo-Json -Depth 4),(New-Object System.Text.UTF8Encoding($false)))
$config=@{root=$repo;panelRoot=$panel;buildId=$buildId;nodePath=(Get-Command node -ErrorAction Stop).Source} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $panel 'config.js'),('window.NAJM_V2_CONFIG='+$config+';'),(New-Object System.Text.UTF8Encoding($false)))
if($EnableUnsignedCepTestMode){$key='HKCU:\Software\Adobe\CSXS.12';New-Item -Path $key -Force | Out-Null;New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null}
Write-Host 'Installed separate NajmEditor Preview panel. No private panel or startup settings were changed. Start the preview engine with npm start, then open the preview panel in Premiere.'
