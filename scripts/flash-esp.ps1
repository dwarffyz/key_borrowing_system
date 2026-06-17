param(
    [string]$Port = '',
    [switch]$InstallIfMissing,
    [switch]$InstallDrivers,
    [switch]$EraseFlash,
    [switch]$SkipServerStart
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Flasher = Join-Path $Root 'flash-esp32-controller.ps1'

if (-not (Test-Path $Flasher)) {
    throw "Missing ESP flasher: $Flasher"
}

$argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Flasher, '-NoPause')
if ($Port) { $argsList += @('-Port', $Port) }
if ($InstallIfMissing) { $argsList += '-InstallIfMissing' }
if ($InstallDrivers) { $argsList += '-InstallDrivers' }
if ($EraseFlash) { $argsList += '-EraseFlash' }
if ($SkipServerStart) { $argsList += '-SkipServerStart' }

& powershell.exe @argsList
exit $LASTEXITCODE

