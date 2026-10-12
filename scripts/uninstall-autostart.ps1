[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$TaskName = 'BatStateU Key Borrowing System Autostart'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host 'Autostart is disabled.' -ForegroundColor Green
} else {
    Write-Host 'Autostart was not enabled for this Windows user.' -ForegroundColor Yellow
}
