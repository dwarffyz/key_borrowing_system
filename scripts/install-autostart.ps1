[CmdletBinding()]
param(
    [ValidateRange(15, 300)]
    [int]$DelaySeconds = 45
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $PSScriptRoot 'start-autostart.ps1'
$TaskName = 'BatStateU Key Borrowing System Autostart'

if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "Missing autostart launcher: $Launcher"
}

$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $PowerShellExe)) {
    $PowerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $Launcher
$action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $arguments -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -RandomDelay (New-TimeSpan -Seconds $DelaySeconds)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Starts the BatStateU Key Borrowing System after user sign-in.' -Force | Out-Null

Write-Host 'Autostart is enabled.' -ForegroundColor Green
Write-Host ("Task: {0}" -f $TaskName)
Write-Host ("It starts about {0} seconds after sign-in without opening a browser." -f $DelaySeconds)
Write-Host 'To disable: powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-autostart.ps1' -ForegroundColor Cyan
