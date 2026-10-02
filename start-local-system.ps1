$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$expectedEspSsid = 'LockerSystem'
$httpPort = 3000

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Test-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal $identity
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Add-UniqueUrl {
    param(
        [System.Collections.Generic.List[string]]$Target,
        [System.Collections.Generic.HashSet[string]]$Seen,
        [string]$Url
    )

    $normalized = ''
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        $normalized = $Url.Trim()
    }
    if (-not $normalized) { return }
    if ($Seen.Add($normalized)) {
        $Target.Add($normalized)
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

function Get-EnvFlag {
    param(
        [string]$Name,
        [bool]$Fallback = $false
    )

    $raw = Get-EnvSetting -Name $Name -Fallback ''
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $Fallback
    }

    switch ($raw.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'y' { return $true }
        'on' { return $true }
        '0' { return $false }
        'false' { return $false }
        'no' { return $false }
        'n' { return $false }
        'off' { return $false }
        default { return $Fallback }
    }
}

function Get-EnvInt {
    param(
        [string]$Name,
        [int]$Fallback
    )

    $raw = Get-EnvSetting -Name $Name -Fallback ''
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }

    return $Fallback
}

function Get-ActiveWifiInfo {
    try {
        $raw = netsh wlan show interfaces 2>$null
        if (-not $raw) { return $null }

        $ssid = ''
        $state = ''
        $name = ''
        foreach ($line in $raw) {
            if ($line -match '^\s*State\s*:\s*(.+)$') {
                $state = $matches[1].Trim()
            } elseif ($line -match '^\s*SSID\s*:\s*(.+)$' -and $line -notmatch 'BSSID') {
                $ssid = $matches[1].Trim()
            } elseif ($line -match '^\s*Name\s*:\s*(.+)$') {
                $name = $matches[1].Trim()
            }
        }

        if (-not $ssid -and -not $name) { return $null }

        return [PSCustomObject]@{
            Name = $name
            SSID = $ssid
            State = $state
        }
    } catch {
        return $null
    }
}

function Test-IsEthernetAdapter {
    param($NetConfig)

    if (-not $NetConfig) { return $false }

    $interfaceText = @(
        [string]$NetConfig.InterfaceAlias,
        [string]$NetConfig.NetAdapter.Name,
        [string]$NetConfig.NetAdapter.InterfaceDescription
    ) -join ' '

    if ($interfaceText -match '(?i)\bethernet\b|\blan\b|\bgbe\b|realtek|intel\(r\).*ethernet') {
        return $true
    }

    try {
        $hardwareInterface = $NetConfig.NetAdapter.HardwareInterface
        if ($hardwareInterface -eq $true -and $interfaceText -notmatch '(?i)\bw(i-?fi|lan)\b|wireless|802\.11') {
            return $true
        }
    } catch {
        # ignore property lookup issues
    }

    return $false
}

function Wait-ForWifiSsid {
    param(
        [string]$ExpectedSsid,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $wifiInfo = Get-ActiveWifiInfo
        if ($wifiInfo -and $wifiInfo.SSID -eq $ExpectedSsid -and $wifiInfo.State -eq 'connected') {
            return $wifiInfo
        }
        Start-Sleep -Milliseconds 900
    }

    return $null
}

function Ensure-EspWifiConnection {
    param([string]$ExpectedSsid)

    if ([string]::IsNullOrWhiteSpace($ExpectedSsid)) {
        return Get-ActiveWifiInfo
    }

    $wifiInfo = Get-ActiveWifiInfo
    if ($wifiInfo -and $wifiInfo.SSID -eq $ExpectedSsid -and $wifiInfo.State -eq 'connected') {
        return $wifiInfo
    }

    $hasProfile = $false
    try {
        $profiles = netsh wlan show profiles 2>$null
        $hasProfile = @($profiles) -match [regex]::Escape($ExpectedSsid)
    } catch {
        $hasProfile = $false
    }

    if (-not $hasProfile) {
        return $wifiInfo
    }

    Write-Step ("Connecting laptop to ESP WiFi '{0}'..." -f $ExpectedSsid)
    try {
        netsh wlan disconnect interface="Wi-Fi" | Out-Null
    } catch {
        # ignore
    }

    Start-Sleep -Seconds 2

    try {
        netsh wlan connect name="$ExpectedSsid" interface="Wi-Fi" | Out-Null
    } catch {
        return Get-ActiveWifiInfo
    }

    $connectedInfo = Wait-ForWifiSsid -ExpectedSsid $ExpectedSsid -TimeoutSeconds 20
    if ($connectedInfo) {
        Start-Sleep -Seconds 2
        return $connectedInfo
    }

    return Get-ActiveWifiInfo
}

function Get-AppUrls {
    param(
        [int]$Port = 3000,
        [string]$Protocol = 'http',
        [bool]$PreferRouterNetwork = $false
    )

    $urls = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $ignoredAdapterPattern = 'virtual|vmware|virtualbox|hyper-v|vethernet|wireguard|loopback|bluetooth'
    $wifiInfo = Get-ActiveWifiInfo
    $scheme = if ([string]::Equals($Protocol, 'https', [System.StringComparison]::OrdinalIgnoreCase)) { 'https' } else { 'http' }

    Add-UniqueUrl -Target $urls -Seen $seen -Url ("{0}://localhost:{1}" -f $scheme, $Port)
    Add-UniqueUrl -Target $urls -Seen $seen -Url ("{0}://127.0.0.1:{1}" -f $scheme, $Port)

    $preferred = [System.Collections.Generic.List[string]]::new()
    $others = [System.Collections.Generic.List[string]]::new()

    try {
        $configs = Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' }
        foreach ($config in $configs) {
            $interfaceText = @(
                [string]$config.InterfaceAlias,
                [string]$config.NetAdapter.InterfaceDescription,
                [string]$config.NetProfile.Name
            ) -join ' '
            if ($interfaceText -match $ignoredAdapterPattern) { continue }

            $preferOnlyEspSubnet = $wifiInfo -and $wifiInfo.SSID -eq $expectedEspSsid
            foreach ($entry in @($config.IPv4Address)) {
                $ip = [string]$entry.IPAddress
                if ([string]::IsNullOrWhiteSpace($ip) -or $ip.StartsWith('169.254.')) { continue }
                if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { continue }
                $url = "{0}://{1}:{2}" -f $scheme, $ip, $Port
                $isEthernetAdapter = Test-IsEthernetAdapter -NetConfig $config
                if ($PreferRouterNetwork -and $ip.StartsWith('192.168.4.')) {
                    $others.Add($url)
                } elseif ($PreferRouterNetwork -and $isEthernetAdapter) {
                    $preferred.Add($url)
                } elseif ($ip.StartsWith('192.168.4.')) {
                    $preferred.Add($url)
                } elseif ($preferOnlyEspSubnet) {
                    continue
                } elseif ($PreferRouterNetwork -and $interfaceText -match [regex]::Escape($wifiInfo.Name)) {
                    $others.Add($url)
                } elseif ($wifiInfo -and $interfaceText -match [regex]::Escape($wifiInfo.Name)) {
                    $preferred.Add($url)
                } else {
                    $others.Add($url)
                }
            }
        }
    } catch {
        # Fallback to localhost only if Windows networking cmdlets are unavailable.
    }

    foreach ($url in $preferred) {
        Add-UniqueUrl -Target $urls -Seen $seen -Url $url
    }
    foreach ($url in $others) {
        Add-UniqueUrl -Target $urls -Seen $seen -Url $url
    }

    return $urls
}

function Get-PreferredPhoneUrl {
    param(
        [System.Collections.Generic.List[string]]$Urls,
        $WifiInfo = $null,
        [int]$Port = 3000,
        [string]$Protocol = 'http',
        [bool]$PreferRouterNetwork = $false
    )

    $scheme = if ([string]::Equals($Protocol, 'https', [System.StringComparison]::OrdinalIgnoreCase)) { 'https' } else { 'http' }
    $escapedScheme = [regex]::Escape($scheme)
    $escapedPort = [regex]::Escape([string]$Port)

    if (-not $PreferRouterNetwork) {
        foreach ($url in $Urls) {
            if ($url -match ("^{0}://192\.168\.4\.\d+:{1}$" -f $escapedScheme, $escapedPort)) {
                return $url
            }
        }
    }

    if ($WifiInfo) {
        foreach ($url in $Urls) {
            if ($url -match ("^{0}://192\.168\.\d+\.\d+:{1}$" -f $escapedScheme, $escapedPort) -or $url -match ("^{0}://10\.\d+\.\d+\.\d+:{1}$" -f $escapedScheme, $escapedPort) -or $url -match ("^{0}://172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:{1}$" -f $escapedScheme, $escapedPort)) {
                return $url
            }
        }
    }

    foreach ($url in $Urls) {
        if ($url -match ("^{0}://(?!localhost|127\.0\.0\.1)" -f $escapedScheme)) {
            return $url
        }
    }

    if ($PreferRouterNetwork) {
        foreach ($url in $Urls) {
            if ($url -match ("^{0}://192\.168\.4\.\d+:{1}$" -f $escapedScheme, $escapedPort)) {
                return $url
            }
        }
    }

    return ("{0}://localhost:{1}" -f $scheme, $Port)
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
        Write-Host ("ESP portal target updated over WiFi: {0}" -f $TargetUrl) -ForegroundColor Green
        return $true
    } catch {
        # fall back to serial
    }

    $serialResponse = Invoke-EspSerialCommand -Command ("SET_URL {0}" -f $TargetUrl)
    if ($serialResponse -match 'SERIAL_OK') {
        Write-Host ("ESP portal target updated over serial: {0}" -f $TargetUrl) -ForegroundColor Green
        return $true
    }

    Write-Host 'Unable to update the ESP portal target automatically. The ESP page may still show an old or empty system URL.' -ForegroundColor Yellow
    return $false
}

function Set-EspStationConfig {
    param(
        [string]$Ssid,
        [string]$Password
    )

    $ssidValue = if ([string]::IsNullOrWhiteSpace($Ssid)) { '' } else { $Ssid.Trim() }
    $passwordValue = if ($null -eq $Password) { '' } else { $Password.Trim() }

    if (-not $ssidValue) {
        return $false
    }

    if ($ssidValue.Contains('|') -or $passwordValue.Contains('|')) {
        Write-Host 'ESP station WiFi setup skipped because the SSID or password contains "|", which is not supported by the current serial provisioning format.' -ForegroundColor Yellow
        return $false
    }

    $serialResponse = Invoke-EspSerialCommand -Command ("SET_STA {0}|{1}" -f $ssidValue, $passwordValue)
    if ($serialResponse -match 'SERIAL_OK') {
        Write-Host ("ESP station WiFi saved: {0}" -f $ssidValue) -ForegroundColor Green
        return $true
    }

    Write-Host 'Unable to save the ESP station WiFi automatically. Keep the ESP connected by USB serial and check the configured COM port.' -ForegroundColor Yellow
    return $false
}

function Clear-EspPortalTarget {
    $espBaseUrl = Get-EnvSetting -Name 'LOCKER_CONTROLLER_BASE_URL' -Fallback 'http://192.168.4.1'

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$espBaseUrl/portal-target?clear=1" -TimeoutSec 4 | Out-Null
        Write-Host 'ESP portal target cleared because the laptop is not on the ESP WiFi.' -ForegroundColor Yellow
        return $true
    } catch {
        # fall back to serial
    }

    $serialResponse = Invoke-EspSerialCommand -Command 'CLEAR_URL'
    if ($serialResponse -match 'SERIAL_OK') {
        Write-Host 'ESP portal target cleared because the laptop is not on the ESP WiFi.' -ForegroundColor Yellow
        return $true
    }

    Write-Host 'Unable to clear the ESP portal target automatically.' -ForegroundColor Yellow
    return $false
}

function Wait-ForApp {
    param([int]$TimeoutSeconds = 25)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/system/runtime-config' -TimeoutSec 3
            if ($response.StatusCode -eq 200 -and $response.Content -match '"success"\s*:\s*true') {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 900
        }
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
    $commandLine = [string]$ProcessInfo.CommandLine
    if ($ProcessInfo.Name -ine 'node.exe') {
        return $false
    }

    return (
        $commandLine -match 'public[\\/]+server[\\/]+server\.js' -or
        $commandLine -match '(^|\s|[\\/])server\.js(\s|$)'
    )
}

function Test-IsExpectedAppServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://localhost:{0}/api/system/runtime-config" -f $httpPort) -TimeoutSec 3
        return ($response.StatusCode -eq 200 -and $response.Content -match '"success"\s*:\s*true')
    } catch {
        return $false
    }
}

function Get-ConflictingAppHint {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://localhost:{0}/" -f $httpPort) -TimeoutSec 3
        $content = [string]$response.Content
        if ($content -match '<title>\s*(.+?)\s*</title>') {
            return (" Detected app: {0}." -f $matches[1].Trim())
        }
    } catch {
        # ignore hint lookup failures
    }

    return ''
}

function Wait-ForPortRelease {
    param([int]$TimeoutSeconds = 12)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $listener) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Ensure-FirewallRule {
    param(
        [string]$RuleName,
        [int]$LocalPort
    )

    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingRule) {
        Write-Host ("Firewall rule for port {0} is already present." -f $LocalPort) -ForegroundColor Green
        return
    }

    if (-not (Test-IsAdministrator)) {
        Write-Host ("Firewall rule for port {0} was not added because this launcher is not running as Administrator. If phones still cannot open the app on the ESP WiFi, run this launcher once as Administrator." -f $LocalPort) -ForegroundColor Yellow
        return
    }

    try {
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Action Allow `
            -Profile Any `
            -Protocol TCP `
            -LocalPort $LocalPort | Out-Null
        Write-Host ("Firewall rule added for TCP port {0}." -f $LocalPort) -ForegroundColor Green
    } catch {
        Write-Host ("Unable to add the firewall rule automatically for port {0}. Phones may still be blocked from reaching the laptop on this network." -f $LocalPort) -ForegroundColor Yellow
    }
}

Write-Step 'Starting BatStateU Key Borrowing System...'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js is not installed or not available in PATH.'
}

$toolsDir = Join-Path $root '.tools'
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
$stdoutLog = Join-Path $toolsDir 'local-system.stdout.log'
$stderrLog = Join-Path $toolsDir 'local-system.stderr.log'
$accessFile = Join-Path $toolsDir 'local-system-urls.txt'
$pidFile = Join-Path $toolsDir 'local-system.pid'

$configuredHttpsPort = Get-EnvInt -Name 'HTTPS_PORT' -Fallback 3443
$espStaSsid = Get-EnvSetting -Name 'ESP_STA_SSID' -Fallback ''
$espStaPassword = Get-EnvSetting -Name 'ESP_STA_PASSWORD' -Fallback ''
$wifiInfo = if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
    Get-ActiveWifiInfo
} else {
    Ensure-EspWifiConnection -ExpectedSsid $expectedEspSsid
}

$preferRouterNetworkForStartup = -not [string]::IsNullOrWhiteSpace($espStaSsid)
$startupHttpUrls = Get-AppUrls -Port $httpPort -Protocol 'http' -PreferRouterNetwork:$preferRouterNetworkForStartup
$startupPhoneUrl = Get-PreferredPhoneUrl -Urls $startupHttpUrls -WifiInfo $wifiInfo -Port $httpPort -Protocol 'http' -PreferRouterNetwork:$preferRouterNetworkForStartup
if (-not [string]::IsNullOrWhiteSpace($startupPhoneUrl) -and $startupPhoneUrl -notmatch 'localhost|127\.0\.0\.1') {
    $env:APP_BASE_URL = $startupPhoneUrl
} else {
    $env:APP_BASE_URL = ("http://localhost:{0}" -f $httpPort)
}

Write-Step 'Checking MongoDB...'
$mongoUri = if (-not [string]::IsNullOrWhiteSpace($env:MONGODB_URI)) {
    $env:MONGODB_URI
} else {
    Get-EnvSetting -Name 'MONGODB_URI' -Fallback 'mongodb://localhost:27017/key_borrowing_system'
}
$usesLocalMongo = $mongoUri -match '^mongodb://(localhost|127\.0\.0\.1)(:|/)'
$dockerReady = $false
try {
    & docker version --format '{{.Server.Version}}' *> $null
    $dockerReady = $LASTEXITCODE -eq 0
    if ($dockerReady) {
        & docker compose version *> $null
        $dockerReady = $LASTEXITCODE -eq 0
    }
} catch {
    $dockerReady = $false
}

if ($usesLocalMongo -and $dockerReady) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start-mongodb.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker MongoDB could not be started.'
    }
} elseif ($usesLocalMongo) {
    $mongoService = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
    if ($mongoService) {
        if ($mongoService.Status -ne 'Running') {
            Start-Service -Name 'MongoDB'
            Start-Sleep -Seconds 2
            Write-Host 'MongoDB service started.' -ForegroundColor Green
        } else {
            Write-Host 'MongoDB service is already running.' -ForegroundColor Green
        }
    } else {
        Write-Host 'Docker Desktop or the MongoDB Windows service was not found. Continuing in case MongoDB is already running another way.' -ForegroundColor Yellow
    }
} else {
    Write-Host 'Using the MongoDB URI configured in public/.env.' -ForegroundColor Green
}

Write-Step 'Checking existing app server...'
$listener = Get-ListeningServerProcessInfo
$reusedExistingServer = $false
if ($listener) {
    if (Test-IsManagedServerProcess -ProcessInfo $listener) {
        Write-Host ("Stopping older managed server on PID {0} so the latest code is loaded..." -f $listener.ProcessId) -ForegroundColor Yellow
        Stop-Process -Id $listener.ProcessId -Force
        if (-not (Wait-ForPortRelease)) {
            throw 'Port 3000 did not become free after stopping the previous server.'
        }
    } elseif (Test-IsExpectedAppServer) {
        $processName = if ([string]::IsNullOrWhiteSpace($listener.Name)) { 'unknown process' } else { $listener.Name }
        Write-Host ("Port 3000 is already serving the Key Borrowing System via PID {0} ({1}). Reusing the existing app server." -f $listener.ProcessId, $processName) -ForegroundColor Green
        $reusedExistingServer = $true
    } else {
        $processName = if ([string]::IsNullOrWhiteSpace($listener.Name)) { 'unknown process' } else { $listener.Name }
        $appHint = Get-ConflictingAppHint
        throw ("Port 3000 is already in use by PID {0} ({1}). Close that app first, then run this launcher again.{2}" -f $listener.ProcessId, $processName, $appHint)
    }
}

if (Test-Path $stdoutLog) { Remove-Item $stdoutLog -Force }
if (Test-Path $stderrLog) { Remove-Item $stderrLog -Force }

if (-not $reusedExistingServer) {
    $process = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList 'public/server/server.js' `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    $process.Id | Set-Content -Path $pidFile -Encoding ASCII
    Write-Host ("Started server process PID {0}." -f $process.Id) -ForegroundColor Green
} elseif (Test-Path $pidFile) {
    Remove-Item $pidFile -Force
}

Write-Step 'Waiting for the app to answer on port 3000...'
if (-not (Wait-ForApp)) {
    Write-Host ''
    Write-Host 'The app did not finish starting in time.' -ForegroundColor Red
    if (Test-Path $stderrLog) {
        Write-Host ''
        Write-Host 'Latest error log:' -ForegroundColor Yellow
        Get-Content $stderrLog
    }
    throw 'App startup failed.'
}

Write-Step 'Checking Windows firewall access...'
Ensure-FirewallRule -RuleName 'BatStateU Key Borrowing System HTTP' -LocalPort $httpPort

$wifiInfo = Get-ActiveWifiInfo
$runtimeConfig = $null
try {
    $runtimeConfig = Invoke-RestMethod -UseBasicParsing -Uri ("http://localhost:{0}/api/system/runtime-config" -f $httpPort) -TimeoutSec 4
} catch {
    $runtimeConfig = $null
}

$localHttpsActive = $false
$httpsPort = $configuredHttpsPort
if ($runtimeConfig -and $runtimeConfig.success -eq $true -and $runtimeConfig.runtime.localHttps) {
    $localHttpsActive = [bool]$runtimeConfig.runtime.localHttps.active
    if ($runtimeConfig.runtime.localHttps.port) {
        $httpsPort = [int]$runtimeConfig.runtime.localHttps.port
    }
}

if ($localHttpsActive) {
    Ensure-FirewallRule -RuleName 'BatStateU Key Borrowing System HTTPS' -LocalPort $httpsPort
}

if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
    Write-Step 'Provisioning ESP house WiFi...'
    Set-EspStationConfig -Ssid $espStaSsid -Password $espStaPassword | Out-Null
}

$preferRouterNetwork = -not [string]::IsNullOrWhiteSpace($espStaSsid)
$httpUrls = Get-AppUrls -Port $httpPort -Protocol 'http' -PreferRouterNetwork:$preferRouterNetwork
$httpsUrls = if ($localHttpsActive) { Get-AppUrls -Port $httpsPort -Protocol 'https' -PreferRouterNetwork:$preferRouterNetwork } else { [System.Collections.Generic.List[string]]::new() }
$urls = [System.Collections.Generic.List[string]]::new()
$seenUrls = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($url in $httpsUrls) {
    Add-UniqueUrl -Target $urls -Seen $seenUrls -Url $url
}
foreach ($url in $httpUrls) {
    Add-UniqueUrl -Target $urls -Seen $seenUrls -Url $url
}

$preferredHttpPhoneUrl = Get-PreferredPhoneUrl -Urls $httpUrls -WifiInfo $wifiInfo -Port $httpPort -Protocol 'http' -PreferRouterNetwork:$preferRouterNetwork
$preferredHttpsPhoneUrl = if ($localHttpsActive) {
    Get-PreferredPhoneUrl -Urls $httpsUrls -WifiInfo $wifiInfo -Port $httpsPort -Protocol 'https' -PreferRouterNetwork:$preferRouterNetwork
} else {
    ''
}
$preferredPhoneUrl = if (
    $preferRouterNetwork `
    -and -not [string]::IsNullOrWhiteSpace($preferredHttpPhoneUrl) `
    -and $preferredHttpPhoneUrl -match '^http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+$'
) {
    $preferredHttpPhoneUrl
} elseif (-not [string]::IsNullOrWhiteSpace($preferredHttpsPhoneUrl) -and $preferredHttpsPhoneUrl -notmatch 'localhost|127\.0\.0\.1') {
    $preferredHttpsPhoneUrl
} else {
    $preferredHttpPhoneUrl
}
$preferredSetupUrl = if ($localHttpsActive -and -not [string]::IsNullOrWhiteSpace($preferredHttpPhoneUrl) -and $preferredHttpPhoneUrl -notmatch 'localhost|127\.0\.0\.1') {
    ("{0}/local-https-setup" -f $preferredHttpPhoneUrl.TrimEnd('/'))
} else {
    ''
}
$urls | Set-Content -Path $accessFile -Encoding UTF8

if ($wifiInfo) {
    Write-Step 'WiFi connection check...'
    $currentSsid = if ([string]::IsNullOrWhiteSpace($wifiInfo.SSID)) { '(unknown)' } else { $wifiInfo.SSID }
    Write-Host ("Current WiFi SSID: {0}" -f $currentSsid) -ForegroundColor White
    if ([string]::IsNullOrWhiteSpace($espStaSsid) -and $wifiInfo.SSID -ne $expectedEspSsid) {
        Write-Host ("This laptop is not connected to the ESP WiFi '{0}' right now. Phones on the ESP WiFi may not reach this laptop until you switch the laptop to that network." -f $expectedEspSsid) -ForegroundColor Yellow
    }
}

Write-Step 'Updating ESP portal target...'
if ($preferredPhoneUrl -match '^https?://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+$') {
    Set-EspPortalTarget -TargetUrl $preferredPhoneUrl | Out-Null
} else {
    Clear-EspPortalTarget | Out-Null
}

Write-Step 'System is ready.'
Write-Host 'Open on this laptop:' -ForegroundColor White
if ($localHttpsActive) {
    Write-Host ("  https://localhost:{0}" -f $httpsPort) -ForegroundColor Green
}
Write-Host ("  http://localhost:{0}" -f $httpPort) -ForegroundColor Green
Write-Host ''
if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
    Write-Host 'Open from phones on the same router/network:' -ForegroundColor White
} else {
    Write-Host 'Open from phones on the same ESP WiFi:' -ForegroundColor White
}
$hasLanUrl = $false
foreach ($url in $urls) {
    if ($url -eq ("http://localhost:{0}" -f $httpPort) -or $url -eq ("http://127.0.0.1:{0}" -f $httpPort) -or $url -eq ("https://localhost:{0}" -f $httpsPort) -or $url -eq ("https://127.0.0.1:{0}" -f $httpsPort)) { continue }
    $hasLanUrl = $true
    Write-Host ("  {0}" -f $url) -ForegroundColor Green
}
if (-not $hasLanUrl) {
    if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
        Write-Host '  No LAN IP was detected yet. Check the ethernet/router network on this laptop, then run this launcher again.' -ForegroundColor Yellow
    } else {
        Write-Host '  No LAN IP was detected yet. Connect this laptop to the ESP WiFi first, then run this launcher again.' -ForegroundColor Yellow
    }
}
Write-Host ''
Write-Host 'Notes:' -ForegroundColor White
if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
    Write-Host '  - Keep the laptop on ethernet if you want. Phones can use the same router WiFi as the ESP station connection.'
    Write-Host '  - The LockerSystem hotspot still stays available as a fallback portal.'
} else {
    Write-Host '  - Connect both the laptop and phones to the ESP WiFi.'
}
Write-Host ("  - Preferred phone URL right now: {0}" -f $preferredPhoneUrl)
if ($localHttpsActive) {
    Write-Host ("  - Secure phone scanner is available on HTTPS port {0}." -f $httpsPort)
    if (-not [string]::IsNullOrWhiteSpace($preferredSetupUrl)) {
        Write-Host ("  - Phone setup page: {0}" -f $preferredSetupUrl)
    }
} else {
    Write-Host '  - Live camera scanning on phones still needs HTTPS. Without it, use the photo-based fallback on the scan page.'
}
if (-not [string]::IsNullOrWhiteSpace($espStaSsid)) {
    Write-Host ("  - ESP station WiFi target: {0}" -f $espStaSsid)
}
Write-Host ("  - Access URLs were also saved to {0}" -f $accessFile)

Start-Process ($(if ($localHttpsActive) { "https://localhost:{0}" -f $httpsPort } else { "http://localhost:{0}" -f $httpPort }))

Write-Host ''
if ($env:KBS_NO_PAUSE -ne '1') {
    Read-Host 'Press Enter to close this launcher window'
}
