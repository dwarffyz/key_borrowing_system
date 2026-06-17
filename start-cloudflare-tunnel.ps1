#requires -version 3.0
[CmdletBinding()]
param(
    [switch]$SetupOnly,
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$tunnelLogFile = Join-Path $toolsDir 'cloudflare-tunnel.log'
$tunnelStdoutFile = Join-Path $toolsDir 'cloudflare-tunnel.stdout.log'
$tunnelStderrFile = Join-Path $toolsDir 'cloudflare-tunnel.stderr.log'
$tunnelUrlFile = Join-Path $toolsDir 'cloudflare-tunnel-url.txt'
$tunnelStateFile = Join-Path $toolsDir 'cloudflare-tunnel-state.json'
$tunnelPidFile = Join-Path $toolsDir 'cloudflare-tunnel.pid'
$localUrlsFile = Join-Path $toolsDir 'local-system-urls.txt'

Set-Location $repoRoot
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

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

function Test-PortListening {
    param([Parameter(Mandatory = $true)][int]$Port)
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $asyncResult = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $asyncResult.AsyncWaitHandle.WaitOne(250)) {
            return $false
        }
        $client.EndConnect($asyncResult) | Out-Null
        return $true
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

function Test-KeyBorrowingServer {
    param([int]$Port = 3000)

    if (-not (Test-PortListening -Port $Port)) {
        return $false
    }

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://localhost:{0}/api/system/runtime-config" -f $Port) -TimeoutSec 3
        if (-not $response -or [int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) {
            return $false
        }
        $payload = $response.Content | ConvertFrom-Json
        $appName = [string]$payload.runtime.appName
        if ([string]::IsNullOrWhiteSpace($appName)) {
            $appName = [string]$payload.appName
        }
        return ($payload.success -eq $true -and $appName -match 'Key Borrowing')
    } catch {
        return $false
    }
}

function Wait-ForApp {
    param(
        [int]$Port = 3000,
        [int]$TimeoutSeconds = 25
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-KeyBorrowingServer -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 900
    }

    return $false
}

function Get-ListeningServerProcessInfo {
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        return $null
    }

    $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
    if (-not $process) {
        return [PSCustomObject]@{
            ProcessId = $listener.OwningProcess
            Name = ''
            CommandLine = ''
            ExecutablePath = ''
        }
    }

    return [PSCustomObject]@{
        ProcessId = $process.ProcessId
        Name = $process.Name
        CommandLine = [string]$process.CommandLine
        ExecutablePath = [string]$process.ExecutablePath
    }
}

function Test-IsManagedServerProcess {
    param($ProcessInfo)

    if (-not $ProcessInfo) { return $false }
    if ($ProcessInfo.Name -ine 'node.exe') { return $false }

    $commandLine = [string]$ProcessInfo.CommandLine
    return (
        $commandLine -match 'public[\\/]+server[\\/]+server\.js' -or
        $commandLine -match '(^|\s|[\\/])server\.js(\s|$)'
    )
}

function Get-ConflictingAppHint {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 3
        $content = [string]$response.Content
        if ($content -match '<title>\s*(.+?)\s*</title>') {
            return (" Detected app: {0}." -f $matches[1].Trim())
        }
    } catch {
        # ignore hint lookup failures
    }

    return ''
}

function Start-NodeServerIfNeeded {
    if (Test-KeyBorrowingServer -Port 3000) {
        Write-Host 'OK: Server already listening on http://localhost:3000' -ForegroundColor Green
        return
    }

    $listener = Get-ListeningServerProcessInfo
    if ($listener) {
        if (Test-IsManagedServerProcess -ProcessInfo $listener) {
            Write-Host ("Key Borrowing server process already owns port 3000 via PID {0}. Waiting for the API to become ready..." -f $listener.ProcessId) -ForegroundColor Yellow
            if (Wait-ForApp -Port 3000 -TimeoutSeconds 25) {
                Write-Host 'OK: Server became ready on http://localhost:3000' -ForegroundColor Green
                return
            }

            throw ("Key Borrowing server process PID {0} is listening on port 3000, but the API did not become ready in time. Try stop-complete-system.bat, then start-complete-system.bat again." -f $listener.ProcessId)
        }

        $appHint = Get-ConflictingAppHint
        throw ("Port 3000 is already in use by a different application. Stop that app first, then run the Cloudflare tunnel again.{0}" -f $appHint)
    }

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'Node.js is not installed or not in PATH. Install Node.js (v16+) then try again.'
    }

    $serverPath = Join-Path $repoRoot 'public\server\server.js'
    if (-not (Test-Path $serverPath)) {
        throw "Cannot find server file: $serverPath"
    }

    Write-Host 'Starting Node server on port 3000...' -ForegroundColor Cyan
    $cmd = "cd /d `"$repoRoot`" && node public\server\server.js"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Minimized | Out-Null

    if (Wait-ForApp -Port 3000 -TimeoutSeconds 25) {
        Write-Host 'OK: Server started on http://localhost:3000' -ForegroundColor Green
        return
    }

    throw 'Server did not start on port 3000. Open a terminal and run: node public\server\server.js'
}

function Get-CloudflaredExe {
    $existing = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Path) { return $existing.Path }
        return 'cloudflared'
    }

    $exePath = Join-Path $toolsDir 'cloudflared.exe'
    if (Test-Path $exePath) { return $exePath }

    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq 'x86' -and $env:PROCESSOR_ARCHITEW6432) {
        $arch = $env:PROCESSOR_ARCHITEW6432
    }

    $asset = switch -Regex ($arch) {
        'ARM64' { 'cloudflared-windows-arm64.exe'; break }
        'AMD64|x64' { 'cloudflared-windows-amd64.exe'; break }
        'x86|i386|386' { 'cloudflared-windows-386.exe'; break }
        default { 'cloudflared-windows-amd64.exe' }
    }

    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"
    Write-Host "Downloading cloudflared ($arch)..." -ForegroundColor Cyan

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
    } catch {
        # ignore
    }

    if ($PSVersionTable.PSVersion.Major -lt 6) {
        Invoke-WebRequest -Uri $url -OutFile $exePath -UseBasicParsing
    } else {
        Invoke-WebRequest -Uri $url -OutFile $exePath
    }

    if (-not (Test-Path $exePath)) {
        throw 'Failed to download cloudflared.'
    }

    $fileSize = (Get-Item $exePath).Length
    if ($fileSize -lt 100000) {
        throw "Downloaded cloudflared looks incomplete ($fileSize bytes). Try again."
    }

    return $exePath
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

function Set-EspPortalTarget {
    param([string]$TargetUrl)

    if ([string]::IsNullOrWhiteSpace($TargetUrl)) { return $false }

    $espBaseUrl = Get-EnvSetting -Name 'LOCKER_CONTROLLER_BASE_URL' -Fallback 'http://192.168.4.1'

    try {
        $encodedUrl = [Uri]::EscapeDataString($TargetUrl)
        Invoke-WebRequest -UseBasicParsing -Uri "$espBaseUrl/portal-target?url=$encodedUrl" -TimeoutSec 4 | Out-Null
        Write-Host "ESP portal target updated over WiFi: $TargetUrl" -ForegroundColor Green
        return $true
    } catch {
        # fall back to serial
    }

    $serialResponse = Invoke-EspSerialCommand -Command ("SET_URL {0}" -f $TargetUrl)
    if ($serialResponse -match 'SERIAL_OK') {
        Write-Host "ESP portal target updated over serial: $TargetUrl" -ForegroundColor Green
        return $true
    }

    Write-Host 'Unable to update the ESP portal target automatically. The ESP page may still show an old or empty system URL.' -ForegroundColor Yellow
    return $false
}

function Get-LocalUrls {
    if (-not (Test-Path $localUrlsFile)) {
        return @()
    }

    return @(Get-Content $localUrlsFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-PreferredFastLocalUrl {
    param([string[]]$Urls)

    foreach ($url in $Urls) {
        if ($url -match '^http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+$') {
            return $url
        }
    }

    foreach ($url in $Urls) {
        if ($url -match '^https://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+$') {
            return $url
        }
    }

    return ''
}

function Get-PreferredEspPortalTarget {
    param([string]$CloudflareUrl)

    $localFastUrl = Get-PreferredFastLocalUrl -Urls (Get-LocalUrls)
    if (-not [string]::IsNullOrWhiteSpace($localFastUrl)) {
        return $localFastUrl
    }

    return [string]$CloudflareUrl
}

function Read-TunnelState {
    if (-not (Test-Path $tunnelStateFile)) {
        return $null
    }

    try {
        return Get-Content $tunnelStateFile -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Write-TunnelState {
    param(
        [string]$PublicUrl = '',
        [bool]$Active = $false,
        [int]$ProcessIdValue = 0
    )

    $payload = [ordered]@{
        active = $Active
        publicUrl = [string]$PublicUrl
        pid = $ProcessIdValue
        updatedAt = (Get-Date).ToString('o')
    }

    $payload | ConvertTo-Json -Compress | Set-Content -Path $tunnelStateFile -Encoding ASCII

    if ($ProcessIdValue -gt 0) {
        Set-Content -Path $tunnelPidFile -Value $ProcessIdValue -Encoding ASCII
    } elseif (Test-Path $tunnelPidFile) {
        Remove-Item $tunnelPidFile -Force
    }

    if ([string]::IsNullOrWhiteSpace($PublicUrl)) {
        if (Test-Path $tunnelUrlFile) {
            Remove-Item $tunnelUrlFile -Force
        }
    } else {
        Set-Content -Path $tunnelUrlFile -Value $PublicUrl -Encoding ASCII
    }
}

function Reset-TunnelFiles {
    foreach ($file in @($tunnelLogFile, $tunnelStdoutFile, $tunnelStderrFile, $tunnelUrlFile, $tunnelPidFile)) {
        if (Test-Path $file) {
            Remove-Item $file -Force
        }
    }

    Write-TunnelState -PublicUrl '' -Active:$false -ProcessIdValue 0
}

function Get-TrackedTunnelProcess {
    $state = Read-TunnelState
    if (-not $state) { return $null }

    $trackedPid = 0
    try { $trackedPid = [int]$state.pid } catch { $trackedPid = 0 }
    if ($trackedPid -le 0) { return $null }

    try {
        $process = Get-Process -Id $trackedPid -ErrorAction Stop
        if ($process.ProcessName -ieq 'cloudflared') {
            return [PSCustomObject]@{
                Process = $process
                State = $state
            }
        }
    } catch {
        return $null
    }

    return $null
}

function Stop-TrackedTunnelProcess {
    $tracked = Get-TrackedTunnelProcess
    if ($tracked -and $tracked.Process) {
        try {
            Stop-Process -Id $tracked.Process.Id -Force -ErrorAction SilentlyContinue
        } catch {
            # ignore
        }
    }
}

function Get-TunnelUrlFromText {
    param([string]$Text)

    $match = [regex]::Match(
        [string]$Text,
        'https://[-a-z0-9]+\.trycloudflare\.com',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    if ($match.Success) {
        return $match.Value.Trim().TrimEnd('/')
    }

    return ''
}

function Wait-ForTunnelUrl {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 40
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $combined = ''
        foreach ($file in @($tunnelStdoutFile, $tunnelStderrFile)) {
            if (Test-Path $file) {
                try {
                    $combined += [Environment]::NewLine + (Get-Content $file -Raw)
                } catch {
                    # ignore transient sharing reads
                }
            }
        }

        $url = Get-TunnelUrlFromText -Text $combined
        if ($url) {
            if ($combined) {
                Set-Content -Path $tunnelLogFile -Value $combined.Trim() -Encoding UTF8
            }
            return $url
        }

        if ($Process.HasExited) {
            break
        }

        Start-Sleep -Milliseconds 500
    }

    return ''
}

$scriptExit = 0
try {
    Write-Host '============================================'
    Write-Host 'Key Borrowing System - Cloudflare Quick Tunnel'
    Write-Host '============================================'
    Write-Host ''
    Write-Host 'This will:'
    Write-Host '1) Ensure the Node server is running on http://localhost:3000'
    Write-Host '2) Start or reuse a public Cloudflare tunnel in the background'
    Write-Host '3) Push the latest tunnel URL to the ESP button portal automatically'
    Write-Host ''

    Start-NodeServerIfNeeded
    $cloudflaredExe = Get-CloudflaredExe

    if ($SetupOnly) {
        Write-Host ''
        Write-Host 'OK: Setup complete.' -ForegroundColor Green
        Write-Host "cloudflared: $cloudflaredExe"
        Write-Host ''
        return
    }

    $tracked = Get-TrackedTunnelProcess
    if ($tracked -and $tracked.State -and $tracked.State.active -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$tracked.State.publicUrl)) {
        $existingUrl = [string]$tracked.State.publicUrl
        $preferredPortalTarget = Get-PreferredEspPortalTarget -CloudflareUrl $existingUrl
        Write-Host 'Cloudflare tunnel is already running in the background.' -ForegroundColor Green
        Write-Host "Public URL: $existingUrl" -ForegroundColor Green
        if ($preferredPortalTarget -and $preferredPortalTarget -ne $existingUrl) {
            Write-Host "ESP portal fast target: $preferredPortalTarget" -ForegroundColor Green
        }
        Set-EspPortalTarget -TargetUrl $preferredPortalTarget | Out-Null
        Write-Host ''
        Write-Host 'Tunnel stays alive even if you close this window.' -ForegroundColor Cyan
        Write-Host 'Use stop-cloudflare-tunnel.bat when you want to stop it.' -ForegroundColor Cyan
        Pause-IfNeeded
        return
    }

    Stop-TrackedTunnelProcess
    Reset-TunnelFiles

    Write-Host 'Starting Cloudflare tunnel in the background...' -ForegroundColor Cyan
    Write-Host 'The launcher will wait for the public URL, sync it to the ESP, then you can close this window.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'IMPORTANT (reCAPTCHA):' -ForegroundColor Yellow
    Write-Host "- Add 'trycloudflare.com' to Allowed Domains in Google reCAPTCHA admin console."
    Write-Host ''

    $process = Start-Process `
        -FilePath $cloudflaredExe `
        -ArgumentList 'tunnel', '--protocol', 'http2', '--url', 'http://localhost:3000' `
        -WindowStyle Hidden `
        -RedirectStandardOutput $tunnelStdoutFile `
        -RedirectStandardError $tunnelStderrFile `
        -PassThru

    $publicUrl = Wait-ForTunnelUrl -Process $process -TimeoutSeconds 40
    if ([string]::IsNullOrWhiteSpace($publicUrl)) {
        if (-not $process.HasExited) {
            try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
        }

        $recent = ''
        if (Test-Path $tunnelStderrFile) {
            $recent = (Get-Content $tunnelStderrFile -Tail 20) -join [Environment]::NewLine
        }

        Reset-TunnelFiles
        if ($recent) {
            throw "Cloudflare tunnel did not produce a public URL. Recent log:`n$recent"
        }
        throw 'Cloudflare tunnel did not produce a public URL.'
    }

    if ($process.HasExited) {
        $exitCode = $process.ExitCode
        Reset-TunnelFiles
        throw "cloudflared exited before the tunnel became ready (code $exitCode)."
    }

    Write-TunnelState -PublicUrl $publicUrl -Active:$true -ProcessIdValue $process.Id
    Write-Host "Public URL ready: $publicUrl" -ForegroundColor Green
    $preferredPortalTarget = Get-PreferredEspPortalTarget -CloudflareUrl $publicUrl
    if ($preferredPortalTarget -and $preferredPortalTarget -ne $publicUrl) {
        Write-Host "ESP portal fast target: $preferredPortalTarget" -ForegroundColor Green
    }
    Set-EspPortalTarget -TargetUrl $preferredPortalTarget | Out-Null

    Write-Host ''
    Write-Host 'Tunnel is running in the background.' -ForegroundColor Green
    Write-Host 'You can close this window now.' -ForegroundColor Green
    Write-Host 'If you restart the tunnel later, a new trycloudflare URL will be generated and auto-synced to the ESP.' -ForegroundColor Cyan
    Write-Host 'To stop the background tunnel cleanly, run stop-cloudflare-tunnel.bat.' -ForegroundColor Cyan
} catch {
    $scriptExit = 1
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
