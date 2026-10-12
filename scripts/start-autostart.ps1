[CmdletBinding()]
param(
    [ValidateRange(1, 12)]
    [int]$AttemptCount = 6,

    [ValidateRange(10, 300)]
    [int]$RetryDelaySeconds = 30
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'start-complete-system.ps1'
$ToolsDir = Join-Path $Root '.tools'
$LogFile = Join-Path $ToolsDir 'autostart.log'

if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "Missing launcher: $Launcher"
}

New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null

# The scheduled task must never open a browser window or wait for keyboard input.
$env:KBS_NO_PAUSE = '1'
$env:KBS_NO_BROWSER = '1'

for ($attempt = 1; $attempt -le $AttemptCount; $attempt += 1) {
    Add-Content -Path $LogFile -Encoding UTF8 -Value ("`n[{0}] Startup attempt {1}/{2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $attempt, $AttemptCount)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Launcher *>> $LogFile
    if ($LASTEXITCODE -eq 0) {
        Add-Content -Path $LogFile -Encoding UTF8 -Value ("[{0}] System startup completed." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
        exit 0
    }

    if ($attempt -lt $AttemptCount) {
        Add-Content -Path $LogFile -Encoding UTF8 -Value ("[{0}] Startup failed; retrying in {1} seconds." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $RetryDelaySeconds)
        Start-Sleep -Seconds $RetryDelaySeconds
    }
}

throw "System startup failed after $AttemptCount attempts. Review $LogFile"
