$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root '.tools'
$localPidFile = Join-Path $toolsDir 'local-system.pid'
$summaryFile = Join-Path $toolsDir 'complete-system-summary.txt'

Set-Location $root

function Pause-IfNeeded {
    if ($env:KBS_NO_PAUSE -eq '1') { return }
    try {
        Read-Host 'Press Enter to close' | Out-Null
    } catch {
        # ignore
    }
}

function Get-PowerShellExe {
    $candidates = @(
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe",
        "$env:SystemRoot\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($pwsh -and $pwsh.Path) {
        return $pwsh.Path
    }

    throw 'PowerShell executable was not found.'
}

function Invoke-LauncherScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [string[]]$Arguments = @()
    )

    $psExe = Get-PowerShellExe
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ("Launcher failed: {0} (exit {1})" -f $ScriptPath, $exitCode)
    }
}

function Get-ListeningServerPid {
    try {
        $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess
        if ($listener) {
            return [int]$listener
        }
    } catch {
        # ignore
    }

    return 0
}

function Test-KeyBorrowingServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/system/runtime-config' -TimeoutSec 3
        if (-not $response -or [int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) {
            return $false
        }
        $payload = $response.Content | ConvertFrom-Json
        return ($payload.success -eq $true -and [string]$payload.appName -match 'Key Borrowing')
    } catch {
        return $false
    }
}

function Stop-ManagedLocalServer {
    if (-not (Test-Path $localPidFile)) {
        Write-Host 'No tracked local server PID was found. Checking port 3000 directly...' -ForegroundColor Yellow
    }

    $trackedPid = 0
    try {
        if (Test-Path $localPidFile) {
            $trackedPid = [int](Get-Content $localPidFile -Raw)
        }
    } catch {
        $trackedPid = 0
    }

    $stopped = $false

    if ($trackedPid -gt 0) {
        try {
            $process = Get-Process -Id $trackedPid -ErrorAction Stop
            if ($process.ProcessName -ieq 'node') {
                Stop-Process -Id $trackedPid -Force
                Write-Host ("Stopped local server PID {0}." -f $trackedPid) -ForegroundColor Green
                $stopped = $true
            }
        } catch {
            Write-Host 'Tracked local server was already stopped.' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'Local server PID file was invalid. Checking port 3000 directly...' -ForegroundColor Yellow
    }

    if (-not $stopped) {
        $listenerPid = Get-ListeningServerPid
        if ($listenerPid -gt 0 -and (Test-KeyBorrowingServer)) {
            try {
                $listenerProcess = Get-Process -Id $listenerPid -ErrorAction Stop
                if ($listenerProcess.ProcessName -ieq 'node') {
                    Stop-Process -Id $listenerPid -Force
                    Write-Host ("Stopped local server on port 3000 via PID {0}." -f $listenerPid) -ForegroundColor Green
                    $stopped = $true
                }
            } catch {
                Write-Host 'Local server on port 3000 was already stopped.' -ForegroundColor Yellow
            }
        } elseif ($listenerPid -gt 0) {
            Write-Host ("Port 3000 is in use by PID {0}, but it is not the Key Borrowing System. Leaving it untouched." -f $listenerPid) -ForegroundColor Yellow
        } else {
            Write-Host 'No Key Borrowing System server is currently listening on port 3000.' -ForegroundColor Yellow
        }
    }

    if (Test-Path $localPidFile) {
        Remove-Item $localPidFile -Force
    }
}

$previousNoPause = $env:KBS_NO_PAUSE
$scriptExit = 0

try {
    $env:KBS_NO_PAUSE = '1'
    Write-Host 'Stopping complete system...' -ForegroundColor Cyan
    Invoke-LauncherScript -ScriptPath (Join-Path $root 'stop-cloudflare-tunnel.ps1') -Arguments @('-NoPause')
    Stop-ManagedLocalServer
    if (Test-Path $summaryFile) {
        Remove-Item $summaryFile -Force
    }
} catch {
    $scriptExit = 1
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $env:KBS_NO_PAUSE = $previousNoPause
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
