param(
    [switch]$LaunchAfterSetup,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root '.tools'
$summaryFile = Join-Path $toolsDir 'setup-new-pc-summary.txt'
$envFile = Join-Path $root 'public\.env'

Set-Location $root
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

$summaryLines = [System.Collections.Generic.List[string]]::new()

function Pause-IfNeeded {
    if ($NoPause -or $env:KBS_NO_PAUSE -eq '1') { return }
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

function Add-SummaryLine {
    param([string]$Line)
    if (-not [string]::IsNullOrWhiteSpace($Line)) {
        $summaryLines.Add($Line) | Out-Null
    }
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

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $combined = @($machinePath, $userPath) -join ';'
    if (-not [string]::IsNullOrWhiteSpace($combined)) {
        $env:Path = $combined
    }
}

function Get-CommandPath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$AdditionalCandidates = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }

    foreach ($candidate in $AdditionalCandidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-Path $candidate) {
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

function Set-EnvSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $contents = if (Test-Path $envFile) {
        Get-Content $envFile
    } else {
        @()
    }

    $updated = $false
    for ($index = 0; $index -lt $contents.Count; $index += 1) {
        if ($contents[$index] -match ("^\s*{0}\s*=" -f [regex]::Escape($Name))) {
            $contents[$index] = ('{0}={1}' -f $Name, $Value)
            $updated = $true
            break
        }
    }

    if (-not $updated) {
        if ($contents.Count -gt 0 -and $contents[-1] -ne '') {
            $contents += ''
        }
        $contents += ('{0}={1}' -f $Name, $Value)
    }

    Set-Content -Path $envFile -Value $contents -Encoding UTF8
}

function Invoke-WingetInstall {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $wingetExe = Get-CommandPath -Name 'winget.exe' -AdditionalCandidates @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe')
    )

    if (-not $wingetExe) {
        throw "winget is required to auto-install $Label on a new PC, but it was not found."
    }

    Write-Host ("Installing {0} via winget..." -f $Label) -ForegroundColor Yellow
    & $wingetExe install --id $Id --exact --accept-package-agreements --accept-source-agreements --disable-interactivity --silent
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ("winget failed while installing {0} (package {1}, exit {2})." -f $Label, $Id, $exitCode)
    }

    Refresh-ProcessPath
}

function Ensure-NodeJs {
    $nodeExe = Get-CommandPath -Name 'node.exe' -AdditionalCandidates @(
        'C:\Program Files\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )

    $needsInstall = $false
    if (-not $nodeExe) {
        $needsInstall = $true
    } else {
        try {
            $versionText = (& $nodeExe -p "process.versions.node").Trim()
            $majorVersion = [int]($versionText.Split('.')[0])
            if ($majorVersion -lt 16) {
                $needsInstall = $true
            }
        } catch {
            $needsInstall = $true
        }
    }

    if ($needsInstall) {
        Invoke-WingetInstall -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
        $nodeExe = Get-CommandPath -Name 'node.exe' -AdditionalCandidates @(
            'C:\Program Files\nodejs\node.exe',
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        )
    }

    if (-not $nodeExe) {
        throw 'Node.js was not found after setup.'
    }

    $npmExe = Get-CommandPath -Name 'npm.cmd' -AdditionalCandidates @(
        'C:\Program Files\nodejs\npm.cmd',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd')
    )
    if (-not $npmExe) {
        throw 'npm was not found after Node.js setup.'
    }

    $nodeVersion = (& $nodeExe -v).Trim()
    Write-Host ("Node.js ready: {0}" -f $nodeVersion) -ForegroundColor Green
    Add-SummaryLine ("Node.js: {0}" -f $nodeVersion)

    return [PSCustomObject]@{
        NodeExe = $nodeExe
        NpmExe  = $npmExe
        Version = $nodeVersion
    }
}

function Invoke-NpmInstall {
    param(
        [Parameter(Mandatory = $true)][string]$NpmExe,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host ("Installing npm packages for {0}..." -f $Label) -ForegroundColor Yellow
    Push-Location $WorkingDirectory
    try {
        & $NpmExe install --no-fund --no-audit
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        throw ("npm install failed for {0} (exit {1})." -f $Label, $exitCode)
    }
}

function Test-TcpPortListening {
    param([int]$Port)

    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Ensure-MongoDb {
    $mongoUri = if (-not [string]::IsNullOrWhiteSpace($env:MONGODB_URI)) {
        $env:MONGODB_URI
    } else {
        Get-EnvSetting -Name 'MONGODB_URI' -Fallback 'mongodb://localhost:27017/key_borrowing_system'
    }
    if ($mongoUri -notmatch '^mongodb://(localhost|127\.0\.0\.1)(:|/)') {
        Write-Host 'Using the MongoDB URI configured in public/.env.' -ForegroundColor Green
        Add-SummaryLine 'MongoDB: external URI configured'
        return
    }

    if (Test-TcpPortListening -Port 27017) {
        Write-Host 'MongoDB is already listening on port 27017.' -ForegroundColor Green
        Add-SummaryLine 'MongoDB: listening on port 27017'
        return
    }

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

    if (-not $dockerReady) {
        throw 'Docker Desktop is required for the bundled MongoDB database. Install and start Docker Desktop, then run setup again. Alternatively, configure a MongoDB Atlas URI in public/.env.'
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start-mongodb.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker MongoDB could not be started.'
    }
    Add-SummaryLine 'MongoDB: Docker container healthy'
}

function Get-DetectedSerialPorts {
    $items = @()

    try {
        $items = @(Get-PnpDevice | Where-Object { $_.Class -eq 'Ports' } | Select-Object FriendlyName, Status)
    } catch {
        $items = @()
    }

    if (-not $items -or $items.Count -eq 0) {
        try {
            $items = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' } | ForEach-Object {
                [PSCustomObject]@{
                    FriendlyName = $_.Name
                    Status = ''
                }
            })
        } catch {
            $items = @()
        }
    }

    $preferredHint = '(?i)ch340|cp210|usb[\s-]*serial|silicon labs|esp|uart'
    $ordered = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $normalizedItems = @($items | ForEach-Object {
        $friendlyName = [string]($_.FriendlyName)
        $status = [string]($_.Status)
        [PSCustomObject]@{
            FriendlyName = $friendlyName
            Status = $status
            Preferred = [bool]($friendlyName -match $preferredHint)
            Healthy = [bool]($status -match '^(OK|Started)$')
        }
    })

    $groups = @(
        @($normalizedItems | Where-Object { $_.Healthy -and $_.Preferred }),
        @($normalizedItems | Where-Object { $_.Healthy -and -not $_.Preferred }),
        @($normalizedItems | Where-Object { -not $_.Healthy -and $_.Preferred }),
        @($normalizedItems | Where-Object { -not $_.Healthy -and -not $_.Preferred })
    )

    foreach ($group in $groups) {
        foreach ($item in $group) {
            $match = [regex]::Match([string]$item.FriendlyName, '\b(COM\d+)\b', 'IgnoreCase')
            if ($match.Success -and $seen.Add($match.Value.ToUpperInvariant())) {
                $ordered.Add($match.Value.ToUpperInvariant()) | Out-Null
            }
        }
    }

    return $ordered
}

function Configure-SerialAutoDetect {
    $detectedPorts = Get-DetectedSerialPorts
    Set-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_AUTO_DETECT' -Value 'true'

    if ($detectedPorts.Count -gt 0) {
        $primaryPort = $detectedPorts[0]
        $allPorts = ($detectedPorts -join ',')
        Set-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORT' -Value $primaryPort
        Set-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORTS' -Value $allPorts
        Write-Host ("ESP serial port detected: {0}" -f $primaryPort) -ForegroundColor Green
        Add-SummaryLine ("ESP serial ports: {0}" -f $allPorts)
        return
    }

    $fallbackPort = Get-EnvSetting -Name 'LOCKER_CONTROLLER_SERIAL_PORT' -Fallback 'COM10'
    Write-Host ("No ESP serial port was auto-detected right now. Keeping fallback port: {0}" -f $fallbackPort) -ForegroundColor Yellow
    Add-SummaryLine ("ESP serial ports: not detected (fallback {0})" -f $fallbackPort)
}

function Write-SummaryFile {
    $lines = @(
        'Key Borrowing System - New PC Setup',
        ('Time: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
        ('Admin mode: {0}' -f $(if (Test-IsAdministrator) { 'Yes' } else { 'No' })),
        ''
    ) + @($summaryLines)

    $lines | Set-Content -Path $summaryFile -Encoding UTF8
}

$scriptExit = 0

try {
    Write-Host '============================================'
    Write-Host 'Key Borrowing System - New PC Setup'
    Write-Host '============================================'
    Write-Host ''
    Write-Host 'This will:'
    Write-Host '1) Check/install Node.js and npm'
    Write-Host '2) Install project npm packages'
    Write-Host '3) Start MongoDB with Docker'
    Write-Host '4) Auto-detect the ESP serial port'
    Write-Host '5) Save a setup summary for this PC'

    Add-SummaryLine ("Project root: {0}" -f $root)
    Add-SummaryLine ("Admin mode: {0}" -f $(if (Test-IsAdministrator) { 'Yes' } else { 'No' }))

    Write-Step 'Checking Node.js...'
    $nodeInfo = Ensure-NodeJs

    Write-Step 'Installing root npm packages...'
    Invoke-NpmInstall -NpmExe $nodeInfo.NpmExe -WorkingDirectory $root -Label 'root project'
    Add-SummaryLine 'Root npm packages: ready'

    Write-Step 'Installing app npm packages...'
    Invoke-NpmInstall -NpmExe $nodeInfo.NpmExe -WorkingDirectory (Join-Path $root 'public') -Label 'public app'
    Add-SummaryLine 'Public app npm packages: ready'

    Write-Step 'Checking MongoDB...'
    Ensure-MongoDb

    Write-Step 'Configuring ESP serial auto-detect...'
    Configure-SerialAutoDetect

    Add-SummaryLine ("Phone access mode: {0}" -f (Get-EnvSetting -Name 'PHONE_ACCESS_MODE' -Fallback 'hybrid'))
    Add-SummaryLine ("ESP station WiFi: {0}" -f (Get-EnvSetting -Name 'ESP_STA_SSID' -Fallback '(not set)'))

    Write-SummaryFile

    Write-Step 'Setup is complete.'
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Green
    Write-Host 'You can now use start-complete-system.bat on this PC.' -ForegroundColor Cyan

    if ($LaunchAfterSetup) {
        Write-Step 'Launching the full system...'
        $psExe = Get-PowerShellExe
        $previousNoPause = $env:KBS_NO_PAUSE
        $env:KBS_NO_PAUSE = '1'
        try {
            & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'start-complete-system.ps1')
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                throw ("start-complete-system.ps1 failed after setup (exit {0})." -f $exitCode)
            }
        } finally {
            $env:KBS_NO_PAUSE = $previousNoPause
        }
    }
} catch {
    $scriptExit = 1
    Add-SummaryLine ("Error: {0}" -f $_.Exception.Message)
    Write-SummaryFile
    Write-Host ''
    Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host ("Setup summary: {0}" -f $summaryFile) -ForegroundColor Yellow
} finally {
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
