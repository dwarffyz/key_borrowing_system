[CmdletBinding()]
param(
    [switch]$ForceCloudflare
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root '.tools'
$localUrlsFile = Join-Path $toolsDir 'local-system-urls.txt'
$tunnelStateFile = Join-Path $toolsDir 'cloudflare-tunnel-state.json'
$summaryFile = Join-Path $toolsDir 'complete-system-summary.txt'

Set-Location $root
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

function Pause-IfNeeded {
    if ($env:KBS_NO_PAUSE -eq '1') { return }
    try {
        Read-Host 'Press Enter to close' | Out-Null
    } catch {
        # ignore
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host $Message -ForegroundColor Cyan
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

function Get-EnvSetting {
    param(
        [string]$Name,
        [string]$Fallback = ''
    )

    $envFile = Join-Path $root 'public\.env'
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

function Get-LocalUrls {
    if (-not (Test-Path $localUrlsFile)) {
        return @()
    }

    return @(Get-Content $localUrlsFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-PreferredLocalUrl {
    param([string[]]$Urls)

    foreach ($url in $Urls) {
        if ($url -match '^https?://(?!localhost|127\.0\.0\.1)') {
            return $url
        }
    }

    return ($Urls | Select-Object -First 1)
}

function Get-PreferredFastPhoneUrl {
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

    return ($Urls | Select-Object -First 1)
}

function Get-PreferredEspPortalUrl {
    param([string[]]$Urls, [string]$CloudflareUrl)

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

    return [string]$CloudflareUrl
}

function Set-EspPortalTarget {
    param([string]$TargetUrl)

    if ([string]::IsNullOrWhiteSpace($TargetUrl)) {
        return $false
    }

    $espBaseUrl = Get-EnvSetting -Name 'LOCKER_CONTROLLER_BASE_URL' -Fallback 'http://192.168.4.1'
    try {
        $encodedUrl = [Uri]::EscapeDataString($TargetUrl)
        Invoke-WebRequest -UseBasicParsing -Uri "$espBaseUrl/portal-target?url=$encodedUrl" -TimeoutSec 4 | Out-Null
        return $true
    } catch {
        # fall back to serial below
    }

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
        $serial.WriteLine(("SET_URL {0}" -f $TargetUrl))
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
        return ($responseText -match 'SERIAL_OK')
    } catch {
        return $false
    }
}

function Set-EspPortalMode {
    param([string]$Mode)

    if ([string]::IsNullOrWhiteSpace($Mode)) {
        return $false
    }

    $normalizedMode = $Mode.Trim().ToLowerInvariant()
    $espBaseUrl = Get-EnvSetting -Name 'LOCKER_CONTROLLER_BASE_URL' -Fallback 'http://192.168.4.1'
    try {
        $encodedMode = [Uri]::EscapeDataString($normalizedMode)
        Invoke-WebRequest -UseBasicParsing -Uri "$espBaseUrl/portal-mode?mode=$encodedMode" -TimeoutSec 4 | Out-Null
        return $true
    } catch {
        # fall back to serial below
    }

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
        $serial.WriteLine(("SET_PORTAL_MODE {0}" -f $normalizedMode))
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
        return ($responseText -match 'SERIAL_OK')
    } catch {
        return $false
    }
}

$previousNoPause = $env:KBS_NO_PAUSE
$scriptExit = 0

try {
    $phoneAccessMode = [string](Get-EnvSetting -Name 'PHONE_ACCESS_MODE' -Fallback 'hybrid')
    $phoneAccessMode = $phoneAccessMode.Trim().ToLowerInvariant()
    if ($phoneAccessMode -notin @('pure_fast', 'hybrid')) {
        $phoneAccessMode = 'hybrid'
    }
    if ($ForceCloudflare) {
        $phoneAccessMode = 'hybrid'
    }
    $espStaSsid = Get-EnvSetting -Name 'ESP_STA_SSID' -Fallback ''

    Write-Host '============================================'
    Write-Host 'Key Borrowing System - One Click Launcher'
    Write-Host '============================================'
    Write-Host ''
    Write-Host 'This will:'
    Write-Host '1) Start the local key borrowing system'
    if ($phoneAccessMode -eq 'pure_fast') {
        Write-Host '2) Use the fastest direct router/LAN path for phones'
        Write-Host '3) Sync the fast local URL to the ESP button portal'
    } else {
        Write-Host '2) Start or reuse the Cloudflare tunnel'
        Write-Host '3) Sync the latest public URL to the ESP button portal'
    }

    $env:KBS_NO_PAUSE = '1'

    Write-Step 'Starting the local system...'
    Invoke-LauncherScript -ScriptPath (Join-Path $root 'start-local-system.ps1')

    $portalMode = if ($phoneAccessMode -eq 'pure_fast') { 'redirect' } else { 'buttons' }

    if ($phoneAccessMode -eq 'pure_fast') {
        Write-Step 'Pure Fast Mode selected. Stopping any old Cloudflare tunnel...'
        Invoke-LauncherScript -ScriptPath (Join-Path $root 'stop-cloudflare-tunnel.ps1') -Arguments @('-NoPause')
    } else {
        Write-Step 'Starting the Cloudflare tunnel...'
        Invoke-LauncherScript -ScriptPath (Join-Path $root 'start-cloudflare-tunnel.ps1') -Arguments @('-NoPause')
    }

    $localUrls = Get-LocalUrls
    $preferredLocalUrl = Get-PreferredLocalUrl -Urls $localUrls
    $preferredFastPhoneUrl = Get-PreferredFastPhoneUrl -Urls $localUrls
    $tunnelState = Read-TunnelState
    $cloudflareUrl = ''
    if ($tunnelState -and $tunnelState.active -eq $true) {
        $cloudflareUrl = [string]$tunnelState.publicUrl
    }
    $espPortalUrl = if ($phoneAccessMode -eq 'pure_fast') {
        $preferredFastPhoneUrl
    } elseif ($ForceCloudflare -and $cloudflareUrl) {
        $cloudflareUrl
    } else {
        Get-PreferredEspPortalUrl -Urls $localUrls -CloudflareUrl $cloudflareUrl
    }
    $localDisplayUrl = if ($preferredLocalUrl) { $preferredLocalUrl } else { 'Not detected' }
    $cloudflareDisplayUrl = if ($phoneAccessMode -eq 'pure_fast') {
        'Disabled in Pure Fast Mode'
    } elseif ($cloudflareUrl) {
        $cloudflareUrl
    } else {
        'Not ready'
    }
    $espDisplayUrl = if ($espPortalUrl) { $espPortalUrl } else { 'Not ready' }
    $phoneDisplayUrl = if ($ForceCloudflare -and $cloudflareUrl) {
        $cloudflareUrl
    } elseif ($preferredFastPhoneUrl) {
        $preferredFastPhoneUrl
    } else {
        $localDisplayUrl
    }

    if ($phoneAccessMode -eq 'pure_fast') {
        $wifiLabel = if ([string]::IsNullOrWhiteSpace($espStaSsid)) { 'your router WiFi' } else { $espStaSsid }
        $summaryLines = @(
            'Key Borrowing System - Ready',
            'Mode: Pure Fast Mode',
            ('Local URL: {0}' -f $localDisplayUrl),
            ('Fast phone URL: {0}' -f $phoneDisplayUrl),
            ('ESP portal target: {0}' -f $espDisplayUrl),
            ('Phone instruction: connect the phone directly to {0}, then open the fast phone URL.' -f $wifiLabel),
            'Cloudflare: disabled for speed in this mode.'
        )
    } else {
        $summaryLines = @(
            'Key Borrowing System - Ready',
            'Mode: Hybrid',
            ('Local URL: {0}' -f $localDisplayUrl),
            ('Cloudflare URL: {0}' -f $cloudflareDisplayUrl),
            ('ESP portal target: {0}' -f $espDisplayUrl),
            'ESP portal behavior: phone should land on the ESP page first, then tap the button to continue.',
            'Note: on router mode, the ESP now prefers the faster local LAN link before Cloudflare.'
        )
    }
    $summaryLines | Set-Content -Path $summaryFile -Encoding UTF8

    if ($espPortalUrl) {
        Set-EspPortalTarget -TargetUrl $espPortalUrl | Out-Null
    }
    Set-EspPortalMode -Mode $portalMode | Out-Null

    Write-Step 'System is ready.'
    if ($preferredLocalUrl) {
        Write-Host ("Local access: {0}" -f $preferredLocalUrl) -ForegroundColor Green
    }
    if ($phoneAccessMode -eq 'pure_fast' -and $phoneDisplayUrl) {
        Write-Host ("Fast phone access: {0}" -f $phoneDisplayUrl) -ForegroundColor Green
    }
    if ($phoneAccessMode -ne 'pure_fast' -and $cloudflareUrl) {
        Write-Host ("Cloudflare access: {0}" -f $cloudflareUrl) -ForegroundColor Green
    } elseif ($phoneAccessMode -ne 'pure_fast') {
        Write-Host 'Cloudflare URL was not available. The local system is still running.' -ForegroundColor Yellow
    } else {
        Write-Host 'Cloudflare tunnel is intentionally disabled in Pure Fast Mode.' -ForegroundColor Cyan
    }
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Cyan
    if ($phoneAccessMode -eq 'pure_fast' -and -not [string]::IsNullOrWhiteSpace($espStaSsid)) {
        Write-Host ("For best speed, connect phones directly to {0} instead of staying on the ESP hotspot." -f $espStaSsid) -ForegroundColor Cyan
    }
    Write-Host 'To stop everything cleanly, run stop-complete-system.bat.' -ForegroundColor Cyan
} catch {
    $scriptExit = 1
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $env:KBS_NO_PAUSE = $previousNoPause
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
