[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'start-local-system.ps1'

if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "Missing launcher: $Launcher"
}

# The scheduled task must never open a browser window or wait for keyboard input.
$env:KBS_NO_PAUSE = '1'
$env:KBS_NO_BROWSER = '1'

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Launcher -NoBrowser -NoPause
exit $LASTEXITCODE
