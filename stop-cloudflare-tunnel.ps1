#requires -version 3.0
[CmdletBinding()]
param(
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$tunnelUrlFile = Join-Path $toolsDir 'cloudflare-tunnel-url.txt'
$tunnelStateFile = Join-Path $toolsDir 'cloudflare-tunnel-state.json'
$tunnelPidFile = Join-Path $toolsDir 'cloudflare-tunnel.pid'

Set-Location $repoRoot

function Pause-IfNeeded {
    param([string]$Message = 'Press Enter to close...')
    if ($NoPause) { return }
    try {
        if ($Host -and $Host.Name -eq 'ConsoleHost') {
            Read-Host $Message | Out-Null
        }
    } catch {
        # ignore
    }
}

function Get-EnvSetting {
    param(
        [string]$Name,
        [string]$Fallback = ''
    )

    $envFile = Join-Path $repoRoot 'public\.env'
    if (-not (Test-Path $envFile)) {
        return $Fallback
    }

    $line = Select-String -Path $envFile -Pattern ("^\s*{0}\s*=" -f [regex]::Escape($Name)) | Select-Object -First 1
    if (-not $line) {
        return $Fallback
    }

    $value = ($line.Line -split '=', 2)[1].Trim()
    return $value.Trim('"')
}

function Invoke-EspSerialCommand {
    param([string]$Command)

    if ([string]::IsNullOrWhiteSpace($Command)) { return '' }

    $serialPort = Get-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORT' -Fallback 'COM10'

    try {
        $serial = New-Object System.IO.Ports.SerialPort $serialPort,115200,'None',8,'One'
        $serial.ReadTimeout = 3000
        $serial.WriteTimeout = 3000
        $serial.DtrEnable = $false
        $serial.RtsEnable = $false
        $serial.NewLine = [Environment]::NewLine
        $serial.Open()
        Start-Sleep -Milliseconds 1400
        $serial.DiscardInBuffer()
        $serial.WriteLine($Command)
        $deadline = (Get-Date).AddMilliseconds(2200)
        $responseBuilder = New-Object System.Text.StringBuilder
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 120
            $incoming = $serial.ReadExisting()
            if (-not [string]::IsNullOrWhiteSpace($incoming)) {
                [void]$responseBuilder.Append($incoming)
                if ($incoming -match 'SERIAL_OK|SERIAL_ERROR|SERIAL_STATUS') {
                    break
                }
            }
        }
        $responseText = $responseBuilder.ToString().Trim()
        $serial.Close()
        $serial.Dispose()
        return $responseText
    } catch {
        return ''
    }
}

function Clear-EspPortalTarget {
    $espBaseUrl = Get-EnvSetting -Name 'LOCKER_CONTROLLER_BASE_URL' -Fallback 'http://192.168.4.1'

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$espBaseUrl/portal-target?clear=1" -TimeoutSec 4 | Out-Null
        Write-Host 'ESP portal target cleared.' -ForegroundColor Yellow
        return $true
    } catch {
        # fall back to serial
    }

    $serialResponse = Invoke-EspSerialCommand -Command 'CLEAR_URL'
    if ($serialResponse -match 'SERIAL_OK') {
        Write-Host 'ESP portal target cleared.' -ForegroundColor Yellow
        return $true
    }

    Write-Host 'Unable to clear the ESP portal target automatically.' -ForegroundColor Yellow
    return $false
}

function Write-TunnelState {
    $payload = [ordered]@{
        active = $false
        publicUrl = ''
        pid = 0
        updatedAt = (Get-Date).ToString('o')
    }

    $payload | ConvertTo-Json -Compress | Set-Content -Path $tunnelStateFile -Encoding ASCII

    if (Test-Path $tunnelPidFile) {
        Remove-Item $tunnelPidFile -Force
    }
    if (Test-Path $tunnelUrlFile) {
        Remove-Item $tunnelUrlFile -Force
    }
}

$scriptExit = 0
try {
    Write-Host 'Stopping Cloudflare tunnel...' -ForegroundColor Cyan

    $trackedPid = 0
    if (Test-Path $tunnelPidFile) {
        $rawPid = Get-Content $tunnelPidFile -Raw
        try { $trackedPid = [int]$rawPid } catch { $trackedPid = 0 }
    }

    if ($trackedPid -gt 0) {
        try {
            $process = Get-Process -Id $trackedPid -ErrorAction Stop
            if ($process.ProcessName -ieq 'cloudflared') {
                Stop-Process -Id $trackedPid -Force
                Write-Host "Stopped cloudflared PID $trackedPid." -ForegroundColor Green
            }
        } catch {
            Write-Host 'Tracked cloudflared process was already stopped.' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'No tracked cloudflared PID was found.' -ForegroundColor Yellow
    }

    Write-TunnelState
    Clear-EspPortalTarget | Out-Null
} catch {
    $scriptExit = 1
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
