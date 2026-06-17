param(
    [string]$Port = '',
    [switch]$InstallIfMissing,
    [switch]$InstallDrivers,
    [switch]$EraseFlash,
    [switch]$SkipServerStart,
    [string]$PreferredVersion = 'v6.1',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root '.tools'
$espProjectDir = Join-Path $root 'hardware\esp32-locker-controller'
$envFile = Join-Path $root 'public\.env'
$summaryFile = Join-Path $toolsDir 'flash-esp32-summary.txt'
$stdoutLog = Join-Path $toolsDir 'flash-esp32.stdout.log'
$stderrLog = Join-Path $toolsDir 'flash-esp32.stderr.log'
$serverStdoutLog = Join-Path $toolsDir 'local-system.stdout.log'
$serverStderrLog = Join-Path $toolsDir 'local-system.stderr.log'
$serverPidFile = Join-Path $toolsDir 'local-system.pid'

Set-Location $root
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

$summaryLines = [System.Collections.Generic.List[string]]::new()

function Pause-IfNeeded {
    if ($NoPause -or $env:KBS_NO_PAUSE -eq '1') { return }
    try { Read-Host 'Press Enter to close' | Out-Null } catch {}
}

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host $Message -ForegroundColor Cyan
}

function Add-SummaryLine {
    param([string]$Line)
    if (-not [string]::IsNullOrWhiteSpace($Line)) {
        $summaryLines.Add($Line) | Out-Null
    }
}

function Write-SummaryFile {
    $lines = @(
        'Key Borrowing System - One Click ESP32 Flash',
        ('Time: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
        ('Project root: {0}' -f $root),
        ('ESP project: {0}' -f $espProjectDir),
        ''
    ) + @($summaryLines)

    $lines | Set-Content -Path $summaryFile -Encoding UTF8
}

function Get-CommandPath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$AdditionalCandidates = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { return $command.Source }

    foreach ($candidate in $AdditionalCandidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return ''
}

function Get-EnvSetting {
    param(
        [string]$Name,
        [string]$Fallback = ''
    )

    if (-not (Test-Path $envFile)) { return $Fallback }

    $line = Select-String -Path $envFile -Pattern ("^\s*{0}\s*=" -f [regex]::Escape($Name)) | Select-Object -First 1
    if (-not $line) { return $Fallback }

    $value = ($line.Line -split '=', 2)[1].Trim()
    return $value.Trim('"')
}

function Set-EnvSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if (-not (Test-Path $envFile)) {
        throw "Environment file was not found: $envFile"
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($line in Get-Content -Path $envFile) {
        if ($line -match ("^\s*{0}\s*=" -f [regex]::Escape($Name))) {
            $lines.Add(("{0}={1}" -f $Name, $Value)) | Out-Null
            $found = $true
        } else {
            $lines.Add($line) | Out-Null
        }
    }

    if (-not $found) {
        $lines.Add(("{0}={1}" -f $Name, $Value)) | Out-Null
    }

    $lines | Set-Content -Path $envFile -Encoding UTF8
}

function Get-VersionSortKey {
    param([string]$Value)

    $match = [regex]::Match([string]$Value, 'v?(\d+)(?:\.(\d+))?(?:\.(\d+))?')
    if (-not $match.Success) { return '000000000' }

    $major = [int]$match.Groups[1].Value
    $minor = if ($match.Groups[2].Success) { [int]$match.Groups[2].Value } else { 0 }
    $patch = if ($match.Groups[3].Success) { [int]$match.Groups[3].Value } else { 0 }
    return ('{0:D3}{1:D3}{2:D3}' -f $major, $minor, $patch)
}

function Get-EspIdfCandidates {
    $items = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    function Add-Candidate {
        param([string]$ExportPath)

        if ([string]::IsNullOrWhiteSpace($ExportPath) -or -not (Test-Path $ExportPath)) { return }
        $resolved = (Resolve-Path $ExportPath).Path
        if (-not $seen.Add($resolved)) { return }

        $rootPath = Split-Path -Parent $resolved
        $versionHint = ''
        foreach ($segment in ($resolved -split '[\\/]')) {
            if ($segment -match '^v\d+(\.\d+){0,2}$') {
                $versionHint = $segment.TrimStart('v')
                break
            }
        }

        $items.Add([PSCustomObject]@{
            ExportPath = $resolved
            RootPath = $rootPath
            Version = $versionHint
            SortKey = Get-VersionSortKey -Value $versionHint
        }) | Out-Null
    }

    if ($env:IDF_PATH) {
        Add-Candidate -ExportPath (Join-Path $env:IDF_PATH 'export.ps1')
    }

    $scanRoots = @(
        (Join-Path $env:USERPROFILE 'Espressif'),
        'C:\Espressif'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path $_) }

    foreach ($scanRoot in $scanRoots) {
        Add-Candidate -ExportPath (Join-Path $scanRoot 'esp-idf\export.ps1')
        Get-ChildItem $scanRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Add-Candidate -ExportPath (Join-Path $_.FullName 'esp-idf\export.ps1')
            Add-Candidate -ExportPath (Join-Path $_.FullName 'export.ps1')
        }
    }

    return @($items | Sort-Object -Property SortKey, ExportPath -Descending)
}

function Test-EspIdfCandidate {
    param([Parameter(Mandatory = $true)]$Candidate)

    $idfPy = Join-Path $Candidate.RootPath 'tools\idf.py'
    $activatePy = Join-Path $Candidate.RootPath 'tools\activate.py'
    if (-not (Test-Path $idfPy) -or -not (Test-Path $activatePy)) { return $false }

    $pythonEnvRoot = Join-Path $env:USERPROFILE '.espressif\python_env'
    if (-not (Test-Path $pythonEnvRoot)) { return $false }

    $pythonEnv = Get-ChildItem -Path $pythonEnvRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'idf*_py*_env' -and (Test-Path (Join-Path $_.FullName 'Scripts\python.exe')) } |
        Select-Object -First 1

    return [bool]$pythonEnv
}

function Ensure-EspIdfReady {
    $candidate = Get-EspIdfCandidates | Where-Object { Test-EspIdfCandidate -Candidate $_ } | Select-Object -First 1
    if ($candidate) { return $candidate }

    if (-not $InstallIfMissing) {
        throw 'ESP-IDF was not detected. Run setup-esp-idf-for-flashing.bat once, or run this script with -InstallIfMissing.'
    }

    $setupScript = Join-Path $root 'setup-esp-idf-for-flashing.ps1'
    if (-not (Test-Path $setupScript)) {
        throw 'ESP-IDF setup script is missing.'
    }

    Write-Step 'ESP-IDF is missing. Installing flashing toolchain first...'
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $setupScript, '-InstallIfMissing', '-NoPause', '-PreferredVersion', $PreferredVersion)
    if ($InstallDrivers) { $args += '-InstallDrivers' }
    $powershellExe = Get-CommandPath -Name 'powershell.exe' -AdditionalCandidates @(
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe",
        "$env:SystemRoot\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    )
    & $powershellExe @args
    if ($LASTEXITCODE -ne 0) {
        throw 'ESP-IDF setup failed.'
    }

    $candidate = Get-EspIdfCandidates | Where-Object { Test-EspIdfCandidate -Candidate $_ } | Select-Object -First 1
    if (-not $candidate) {
        throw 'ESP-IDF setup completed, but the toolchain still was not detected.'
    }
    return $candidate
}

function Get-DetectedEspPorts {
    $ports = [System.Collections.Generic.List[object]]::new()
    try {
        $devices = Get-PnpDevice -PresentOnly -Class Ports -ErrorAction SilentlyContinue
        foreach ($device in $devices) {
            $name = [string]$device.FriendlyName
            if ($name -match '\((COM\d+)\)') {
                $score = if ($name -match '(?i)(CH340|CP210|USB Serial|UART|Silicon Labs|Espressif|ESP32)') { 100 } else { 10 }
                $ports.Add([PSCustomObject]@{
                    Port = $matches[1].ToUpperInvariant()
                    Name = $name
                    Score = $score
                }) | Out-Null
            }
        }
    } catch {}

    try {
        foreach ($serialPort in [System.IO.Ports.SerialPort]::GetPortNames()) {
            if (-not ($ports | Where-Object { $_.Port -eq $serialPort.ToUpperInvariant() })) {
                $ports.Add([PSCustomObject]@{
                    Port = $serialPort.ToUpperInvariant()
                    Name = 'Serial port'
                    Score = 1
                }) | Out-Null
            }
        }
    } catch {}

    return @($ports | Sort-Object -Property Score, Port -Descending)
}

function Resolve-EspPort {
    if (-not [string]::IsNullOrWhiteSpace($Port)) {
        return $Port.Trim().ToUpperInvariant()
    }

    $configured = Get-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORT' -Fallback ''
    $detected = Get-DetectedEspPorts

    if ($configured) {
        $configuredMatch = $detected | Where-Object { $_.Port -eq $configured.Trim().ToUpperInvariant() } | Select-Object -First 1
        if ($configuredMatch) { return $configuredMatch.Port }
    }

    $best = $detected | Select-Object -First 1
    if ($best) {
        Add-SummaryLine ("Detected serial device: {0} ({1})" -f $best.Port, $best.Name)
        return $best.Port
    }

    if ($configured -and $configured.Trim() -match '^COM\d+$') {
        $fallbackPort = $configured.Trim().ToUpperInvariant()
        Write-Host ("No live COM device was listed by Windows, so using configured fallback: {0}" -f $fallbackPort) -ForegroundColor Yellow
        Add-SummaryLine ("ESP serial port fallback: {0}" -f $fallbackPort)
        return $fallbackPort
    }

    throw 'No ESP serial port was detected. Plug in the ESP32 USB cable, wait for Windows to detect it, then run again.'
}

function Invoke-EspSerialCommand {
    param(
        [Parameter(Mandatory = $true)][string]$PortName,
        [Parameter(Mandatory = $true)][string]$Command,
        [int]$TimeoutMs = 4500
    )

    try {
        $serial = New-Object System.IO.Ports.SerialPort $PortName,115200,'None',8,'One'
        $serial.ReadTimeout = 200
        $serial.WriteTimeout = 1000
        $serial.DtrEnable = $false
        $serial.RtsEnable = $false
        $serial.Open()
        try {
            Start-Sleep -Milliseconds 250
            try { $serial.DiscardInBuffer() } catch {}
            $serial.WriteLine($Command)
            $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
            $lines = [System.Collections.Generic.List[string]]::new()
            while ((Get-Date) -lt $deadline) {
                try {
                    $line = $serial.ReadLine()
                    if ($null -ne $line) {
                        $trimmed = $line.Trim()
                        if ($trimmed) {
                            $lines.Add($trimmed) | Out-Null
                            if ($trimmed -match '^SERIAL_(OK|STATUS|ERROR)') { break }
                        }
                    }
                } catch [System.TimeoutException] {}
            }
            return ($lines -join [Environment]::NewLine)
        } finally {
            if ($serial.IsOpen) { $serial.Close() }
            $serial.Dispose()
        }
    } catch {
        return ''
    }
}

function Invoke-IdfCommand {
    param(
        [Parameter(Mandatory = $true)][string]$ExportPath,
        [Parameter(Mandatory = $true)][string]$CommandText
    )

    $powershellExe = Get-CommandPath -Name 'powershell.exe' -AdditionalCandidates @(
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe",
        "$env:SystemRoot\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    )
    if (-not $powershellExe) { throw 'PowerShell executable was not found.' }

    $safeExport = $ExportPath.Replace("'", "''")
    $safeProject = $espProjectDir.Replace("'", "''")
    $command = ". '$safeExport'; Set-Location '$safeProject'; $CommandText; exit `$LASTEXITCODE"

    $outFile = Join-Path $toolsDir 'flash-esp32.idf.out.tmp.log'
    $errFile = Join-Path $toolsDir 'flash-esp32.idf.err.tmp.log'
    if (Test-Path $outFile) { Remove-Item $outFile -Force }
    if (Test-Path $errFile) { Remove-Item $errFile -Force }

    $process = Start-Process -FilePath $powershellExe `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
        -WorkingDirectory $espProjectDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError $errFile `
        -Wait `
        -PassThru

    $outText = if (Test-Path $outFile) { Get-Content -Raw -Path $outFile } else { '' }
    $errText = if (Test-Path $errFile) { Get-Content -Raw -Path $errFile } else { '' }
    if ($outText) {
        Add-Content -Path $stdoutLog -Value $outText
        Write-Host $outText
    }
    if ($errText) {
        Add-Content -Path $stdoutLog -Value $errText
        Write-Host $errText
    }

    if ($process.ExitCode -ne 0) {
        $tail = (($errText + "`n" + $outText) -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Last 8) -join ' '
        throw ("ESP-IDF command failed (exit {0}): {1}. {2}" -f $process.ExitCode, $CommandText, $tail)
    }
}

function Wait-ForSerialStatus {
    param(
        [string]$PortName,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $response = Invoke-EspSerialCommand -PortName $PortName -Command 'STATUS' -TimeoutMs 3500
        if ($response -match 'SERIAL_STATUS') { return $response }
        Start-Sleep -Milliseconds 800
    }
    return ''
}

function Get-LocalNetworkAppUrl {
    $httpPort = Get-EnvSetting -Name 'PORT' -Fallback '3000'
    $ignoredAdapterPattern = 'virtual|vmware|virtualbox|hyper-v|vethernet|wireguard|loopback|bluetooth'

    try {
        $configs = Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' }
        foreach ($config in $configs) {
            $interfaceText = @(
                [string]$config.InterfaceAlias,
                [string]$config.NetAdapter.InterfaceDescription,
                [string]$config.NetProfile.Name
            ) -join ' '
            if ($interfaceText -match $ignoredAdapterPattern) { continue }

            foreach ($entry in @($config.IPv4Address)) {
                $ip = [string]$entry.IPAddress
                if ([string]::IsNullOrWhiteSpace($ip) -or $ip.StartsWith('169.254.') -or $ip.StartsWith('127.')) { continue }
                if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { continue }
                return ("http://{0}:{1}" -f $ip, $httpPort)
            }
        }
    } catch {}

    return ("http://localhost:{0}" -f $httpPort)
}

function Start-Or-RestartServer {
    if ($SkipServerStart) { return }

    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Write-Host 'Node.js was not found, so the local app server was not started.' -ForegroundColor Yellow
        return
    }

    $listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in @($listeners)) {
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
        $commandLine = [string]$process.CommandLine
        if ($process.Name -ieq 'node.exe' -and $commandLine -match 'public[\\/]+server[\\/]+server\.js') {
            Write-Host ("Restarting local app server PID {0}..." -f $process.ProcessId) -ForegroundColor Yellow
            Stop-Process -Id $process.ProcessId -Force
            Start-Sleep -Seconds 2
        }
    }

    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        Write-Host 'Port 3000 is already in use by another app. Skipping server start.' -ForegroundColor Yellow
        return
    }

    if (Test-Path $serverStdoutLog) { Remove-Item $serverStdoutLog -Force }
    if (Test-Path $serverStderrLog) { Remove-Item $serverStderrLog -Force }

    $process = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList 'public/server/server.js' `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverStdoutLog `
        -RedirectStandardError $serverStderrLog `
        -PassThru

    $process.Id | Set-Content -Path $serverPidFile -Encoding ASCII
    Write-Host ("Local app server started on PID {0}." -f $process.Id) -ForegroundColor Green

    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/system/runtime-config' -TimeoutSec 3
            if ($response.StatusCode -eq 200 -and $response.Content -match '"success"\s*:\s*true') {
                Write-Host 'Local app server is responding.' -ForegroundColor Green
                return
            }
        } catch {
            Start-Sleep -Milliseconds 900
        }
    }

    Write-Host 'Local app server did not answer yet. Check .tools/local-system.stderr.log if needed.' -ForegroundColor Yellow
}

function Stop-ManagedServer {
    $stoppedAny = $false
    $listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in @($listeners)) {
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
        $commandLine = [string]$process.CommandLine
        if ($process.Name -ieq 'node.exe' -and $commandLine -match 'public[\\/]+server[\\/]+server\.js') {
            Write-Host ("Stopping local app server PID {0} before flashing..." -f $process.ProcessId) -ForegroundColor Yellow
            Stop-Process -Id $process.ProcessId -Force
            $stoppedAny = $true
            Start-Sleep -Seconds 2
        }
    }
    return $stoppedAny
}

function Test-AppCanSeeController {
    try {
        $username = Get-EnvSetting -Name 'ADMIN_USERNAME' -Fallback 'CPETadmin'
        $password = Get-EnvSetting -Name 'ADMIN_PASSWORD' -Fallback 'admin123!'
        $loginBody = @{ username = $username; password = $password } | ConvertTo-Json
        $login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/admin/login' -ContentType 'application/json' -Body $loginBody -TimeoutSec 10
        $token = [string]$login.token
        if (-not $token) { return $false }
        $status = Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/api/admin/locker-controller/status' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15
        if ($status.controller.connected -eq $true) {
            Write-Host ("App sees ESP: {0} on {1}" -f $status.controller.reason, $status.controller.serial.port) -ForegroundColor Green
            return $true
        }
        Write-Host ("App did not see ESP yet: {0}" -f $status.controller.message) -ForegroundColor Yellow
        return $false
    } catch {
        Write-Host 'App controller verification skipped or failed. The flash itself can still be OK.' -ForegroundColor Yellow
        return $false
    }
}

$scriptExit = 0
$serverStoppedForFlash = $false

try {
    Write-Host '============================================'
    Write-Host 'Key Borrowing System - One Click ESP32 Flash'
    Write-Host '============================================'

    if (-not (Test-Path $espProjectDir)) {
        throw "ESP project folder was not found: $espProjectDir"
    }

    if (Test-Path $stdoutLog) { Remove-Item $stdoutLog -Force }
    if (Test-Path $stderrLog) { Remove-Item $stderrLog -Force }

    Write-Step '1) Detecting ESP-IDF toolchain...'
    $idf = Ensure-EspIdfReady
    Add-SummaryLine ("ESP-IDF export: {0}" -f $idf.ExportPath)
    Write-Host ("Using ESP-IDF export: {0}" -f $idf.ExportPath) -ForegroundColor Green

    Write-Step '2) Detecting plugged-in ESP32...'
    $resolvedPort = Resolve-EspPort
    Add-SummaryLine ("ESP serial port: {0}" -f $resolvedPort)
    Write-Host ("Using ESP serial port: {0}" -f $resolvedPort) -ForegroundColor Green
    Set-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORT' -Value $resolvedPort
    Add-SummaryLine 'Updated public/.env LOCKER_CONTROLLER_SERIAL_PORT'

    Write-Step '3) Building and flashing firmware...'
    $serverStoppedForFlash = Stop-ManagedServer
    if ($EraseFlash) {
        Write-Host 'Erasing flash first because -EraseFlash was provided.' -ForegroundColor Yellow
        Invoke-IdfCommand -ExportPath $idf.ExportPath -CommandText ("idf.py -p {0} erase-flash" -f $resolvedPort)
    }
    Invoke-IdfCommand -ExportPath $idf.ExportPath -CommandText ("idf.py -p {0} flash" -f $resolvedPort)
    Add-SummaryLine 'Firmware flash: success'

    Write-Step '4) Verifying ESP serial status...'
    Start-Sleep -Seconds 3
    $statusResponse = Wait-ForSerialStatus -PortName $resolvedPort -TimeoutSeconds 25
    if ($statusResponse -match 'SERIAL_STATUS') {
        Write-Host $statusResponse -ForegroundColor Green
        Add-SummaryLine ("Serial status: {0}" -f ($statusResponse -replace "\r?\n", ' | '))
    } else {
        Write-Host 'Firmware flashed, but STATUS did not answer over serial yet.' -ForegroundColor Yellow
        Add-SummaryLine 'Serial status: no response after flash'
    }

    Write-Step '5) Provisioning ESP connection settings...'
    $staSsid = Get-EnvSetting -Name 'ESP_STA_SSID' -Fallback ''
    $staPassword = Get-EnvSetting -Name 'ESP_STA_PASSWORD' -Fallback ''
    if (-not [string]::IsNullOrWhiteSpace($staSsid)) {
        if ($staSsid.Contains('|') -or $staPassword.Contains('|')) {
            Write-Host 'Skipped STA WiFi provisioning because SSID/password contains "|".' -ForegroundColor Yellow
        } else {
            $staResponse = Invoke-EspSerialCommand -PortName $resolvedPort -Command ("SET_STA {0}|{1}" -f $staSsid.Trim(), $staPassword.Trim()) -TimeoutMs 6500
            if ($staResponse -match 'SERIAL_OK') {
                Write-Host ("Saved ESP station WiFi: {0}" -f $staSsid.Trim()) -ForegroundColor Green
                Add-SummaryLine ("ESP STA WiFi: saved ({0})" -f $staSsid.Trim())
            } else {
                Write-Host 'Unable to save ESP station WiFi automatically.' -ForegroundColor Yellow
                Add-SummaryLine 'ESP STA WiFi: save failed'
            }
        }
    } else {
        Write-Host 'ESP_STA_SSID is blank, so station WiFi provisioning was skipped.' -ForegroundColor Yellow
    }

    $appUrl = Get-LocalNetworkAppUrl
    $urlResponse = Invoke-EspSerialCommand -PortName $resolvedPort -Command ("SET_URL {0}" -f $appUrl) -TimeoutMs 6500
    if ($urlResponse -match 'SERIAL_OK') {
        Write-Host ("ESP portal target set to: {0}" -f $appUrl) -ForegroundColor Green
        Add-SummaryLine ("ESP portal target: {0}" -f $appUrl)
    } else {
        Write-Host 'Unable to set ESP portal URL automatically.' -ForegroundColor Yellow
        Add-SummaryLine 'ESP portal target: set failed'
    }

    Write-Step '6) Starting app and checking tracking...'
    Start-Or-RestartServer
    [void](Test-AppCanSeeController)

    Write-Step 'Done.'
    Write-Host 'ESP32 flash completed. Settings should show USB Fallback Ready or Connected after refresh.' -ForegroundColor Green
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Green
} catch {
    $scriptExit = 1
    Add-SummaryLine ("Error: {0}" -f $_.Exception.Message)
    Write-Host ''
    Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($serverStoppedForFlash -and -not $SkipServerStart) {
        Write-Host 'Restarting local app server after the failed flash attempt...' -ForegroundColor Yellow
        Start-Or-RestartServer
    }
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Yellow
} finally {
    Write-SummaryFile
    Pause-IfNeeded
    exit $scriptExit
}
