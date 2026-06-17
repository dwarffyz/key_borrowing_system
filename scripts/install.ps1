param(
    [switch]$LaunchAfterSetup
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Setup = Join-Path $Root 'setup-new-pc.ps1'

if (-not (Test-Path $Setup)) {
    throw "Missing setup script: $Setup"
}

$argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Setup, '-NoPause')
if ($LaunchAfterSetup) {
    $argsList += '-LaunchAfterSetup'
}

& powershell.exe @argsList
exit $LASTEXITCODE

