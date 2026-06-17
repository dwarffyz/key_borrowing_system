$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'start-complete-system.ps1'

if (-not (Test-Path $Launcher)) {
    throw "Missing launcher: $Launcher"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Launcher
exit $LASTEXITCODE

