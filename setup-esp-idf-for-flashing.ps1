param(
    [switch]$InstallIfMissing,
    [switch]$InstallDrivers,
    [string]$PreferredVersion = 'v6.1',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root '.tools'
$summaryFile = Join-Path $toolsDir 'setup-esp-idf-summary.txt'
$espProjectDir = Join-Path $root 'hardware\esp32-locker-controller'

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

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extraPath = @(
        'C:\Espressif\tools\git\cmd',
        'C:\Espressif\tools\git\bin'
    ) | Where-Object { Test-Path $_ }
    $combined = @($machinePath, $userPath) + $extraPath -join ';'
    if (-not [string]::IsNullOrWhiteSpace($combined)) {
        $env:Path = $combined
    }
}

function Get-GitExe {
    Refresh-ProcessPath
    return Get-CommandPath -Name 'git.exe' -AdditionalCandidates @(
        'C:\Espressif\tools\git\cmd\git.exe',
        'C:\Espressif\tools\git\bin\git.exe'
    )
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

function Get-VersionSortKey {
    param([string]$Value)

    $match = [regex]::Match([string]$Value, 'v?(\d+)(?:\.(\d+))?(?:\.(\d+))?')
    if (-not $match.Success) {
        return '000000000'
    }

    $major = [int]$match.Groups[1].Value
    $minor = if ($match.Groups[2].Success) { [int]$match.Groups[2].Value } else { 0 }
    $patch = if ($match.Groups[3].Success) { [int]$match.Groups[3].Value } else { 0 }
    return ('{0:D3}{1:D3}{2:D3}' -f $major, $minor, $patch)
}

function Get-EspIdfCandidates {
    $items = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    function Add-Candidate {
        param(
            [string]$ExportPath,
            [string]$Source
        )

        if ([string]::IsNullOrWhiteSpace($ExportPath) -or -not (Test-Path $ExportPath)) {
            return
        }

        $resolved = (Resolve-Path $ExportPath).Path
        if (-not $seen.Add($resolved)) {
            return
        }

        $rootPath = Split-Path -Parent $resolved
        $versionHint = ''
        $segments = $resolved -split '[\\/]'
        foreach ($segment in $segments) {
            if ($segment -match '^v\d+(\.\d+){0,2}$') {
                $versionHint = $segment.TrimStart('v')
                break
            }
        }
        if (-not $versionHint) {
            $match = [regex]::Match($resolved, 'esp-idf[^\\\/]*[\\\/]?v?(\d+(?:\.\d+){0,2})?', 'IgnoreCase')
            if ($match.Success -and $match.Groups[1].Value) {
                $versionHint = $match.Groups[1].Value
            }
        }

        $items.Add([PSCustomObject]@{
            ExportPath = $resolved
            RootPath = $rootPath
            Source = $Source
            Version = $versionHint
            SortKey = Get-VersionSortKey -Value $versionHint
        }) | Out-Null
    }

    if ($env:IDF_PATH) {
        Add-Candidate -ExportPath (Join-Path $env:IDF_PATH 'export.ps1') -Source 'IDF_PATH'
    }

    $scanRoots = @(
        (Join-Path $env:USERPROFILE 'Espressif'),
        'C:\Espressif'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path $_) }

    foreach ($scanRoot in $scanRoots) {
        try {
            Add-Candidate -ExportPath (Join-Path $scanRoot 'esp-idf\export.ps1') -Source $scanRoot

            Get-ChildItem $scanRoot -Directory -ErrorAction SilentlyContinue |
                ForEach-Object {
                    Add-Candidate -ExportPath (Join-Path $_.FullName 'esp-idf\export.ps1') -Source $scanRoot
                    Add-Candidate -ExportPath (Join-Path $_.FullName 'export.ps1') -Source $scanRoot
                }
        } catch {
            # ignore scan issues
        }
    }

    return @($items | Sort-Object -Property SortKey, ExportPath -Descending)
}

function Test-EspIdfCandidate {
    param([Parameter(Mandatory = $true)]$Candidate)

    try {
        $idfPy = Join-Path $Candidate.RootPath 'tools\idf.py'
        $activatePy = Join-Path $Candidate.RootPath 'tools\activate.py'
        if (-not (Test-Path $idfPy) -or -not (Test-Path $activatePy)) {
            return [PSCustomObject]@{
                Candidate = $Candidate
                Success = $false
                Output = 'ESP-IDF export script exists, but required tools were not found.'
            }
        }

        $pythonEnvRoot = Join-Path $env:USERPROFILE '.espressif\python_env'
        $pythonEnv = ''
        if (Test-Path $pythonEnvRoot) {
            $pythonEnv = Get-ChildItem -Path $pythonEnvRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'idf*_py*_env' -and (Test-Path (Join-Path $_.FullName 'Scripts\python.exe')) } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1 -ExpandProperty FullName
        }

        return [PSCustomObject]@{
            Candidate = $Candidate
            Success = -not [string]::IsNullOrWhiteSpace($pythonEnv)
            Output = if ($pythonEnv) { "ESP-IDF files and Python environment detected: $pythonEnv" } else { 'ESP-IDF Python environment was not found.' }
        }
    } catch {
        return [PSCustomObject]@{
            Candidate = $Candidate
            Success = $false
            Output = $_.Exception.Message
        }
    }
}

function Ensure-EimCli {
    function Get-EimCandidates {
        $candidates = [System.Collections.Generic.List[string]]::new()
        $known = @(
            (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\eim.exe'),
            (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\eim.exe')
        )
        foreach ($candidate in $known) {
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $candidates.Add($candidate) | Out-Null
            }
        }

        $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path $wingetPackages) {
            Get-ChildItem -Path $wingetPackages -Recurse -Filter eim.exe -ErrorAction SilentlyContinue |
                ForEach-Object { $candidates.Add($_.FullName) | Out-Null }
        }

        return @($candidates)
    }

    $eimExe = Get-CommandPath -Name 'eim.exe' -AdditionalCandidates (Get-EimCandidates)
    if ($eimExe) {
        return $eimExe
    }

    $wingetExe = Get-CommandPath -Name 'winget.exe' -AdditionalCandidates @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe')
    )
    if (-not $wingetExe) {
        throw 'winget is required to install ESP-IDF tools automatically, but it was not found.'
    }

    Write-Host 'Installing ESP-IDF Installation Manager CLI via winget...' -ForegroundColor Yellow
    $wingetOutput = & $wingetExe install --id Espressif.EIM-CLI --exact --accept-package-agreements --accept-source-agreements --disable-interactivity --silent 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in @($wingetOutput)) {
        if ($null -ne $line -and -not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-Host ([string]$line)
        }
    }
    Refresh-ProcessPath
    $eimExe = Get-CommandPath -Name 'eim.exe' -AdditionalCandidates (Get-EimCandidates)
    if ($exitCode -ne 0 -and -not $eimExe) {
        throw ("winget failed while installing ESP-IDF Installation Manager CLI (exit {0})." -f $exitCode)
    }
    if (-not $eimExe) {
        throw 'ESP-IDF Installation Manager CLI was not found after installation.'
    }

    return $eimExe
}

function Install-EspIdfWithEim {
    param(
        [Parameter(Mandatory = $true)][string]$EimExe,
        [Parameter(Mandatory = $true)][string]$Version
    )

    $installBase = Join-Path $env:USERPROFILE 'Espressif'
    Write-Host ("Installing ESP-IDF {0} for target esp32..." -f $Version) -ForegroundColor Yellow

    & $EimExe install `
        --path $installBase `
        --idf-versions $Version `
        --target esp32 `
        --non-interactive true `
        --install-all-prerequisites true `
        --cleanup true `
        --create-bat-activation-script true

    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ("ESP-IDF installation failed (exit {0})." -f $exitCode)
    }
}

function Ensure-EspIdfPythonEnvironment {
    param([Parameter(Mandatory = $true)][string]$Version)

    $versionFolder = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
    $installScript = Join-Path $env:USERPROFILE ("Espressif\{0}\esp-idf\install.ps1" -f $versionFolder)
    if (-not (Test-Path $installScript)) {
        $plainVersionFolder = $Version.TrimStart('v')
        $installScript = Join-Path $env:USERPROFILE ("Espressif\{0}\esp-idf\install.ps1" -f $plainVersionFolder)
    }
    if (-not (Test-Path $installScript)) {
        return
    }

    $exportScript = Join-Path (Split-Path -Parent $installScript) 'export.ps1'
    if (Test-Path $exportScript) {
        $test = Test-EspIdfCandidate -Candidate ([PSCustomObject]@{
            ExportPath = (Resolve-Path $exportScript).Path
            RootPath = Split-Path -Parent (Resolve-Path $exportScript).Path
            Version = $Version.TrimStart('v')
        })
        if ($test.Success) {
            return
        }
    }

    Write-Host 'Finalizing ESP-IDF Python environment for esp32...' -ForegroundColor Yellow
    $installOutput = & $installScript esp32 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in @($installOutput)) {
        if ($null -ne $line -and -not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-Host ([string]$line)
        }
    }
    if ($exitCode -ne 0) {
        throw ("ESP-IDF Python/tool setup failed (exit {0})." -f $exitCode)
    }
}

function Ensure-EspIdfSubmodules {
    param([Parameter(Mandatory = $true)][string]$IdfRoot)

    $gitExe = Get-GitExe
    if (-not $gitExe) {
        Write-Host 'Git was not found; skipping ESP-IDF submodule repair.' -ForegroundColor Yellow
        Add-SummaryLine 'ESP-IDF submodules: skipped (git not found)'
        return
    }

    $mbedtlsInclude = Join-Path $IdfRoot 'components\mbedtls\mbedtls\include'
    if (Test-Path $mbedtlsInclude) {
        Add-SummaryLine 'ESP-IDF submodules: present'
        return
    }

    Write-Host 'Repairing ESP-IDF submodules...' -ForegroundColor Yellow
    $submoduleOutput = & $gitExe -C $IdfRoot submodule update --init --recursive 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in @($submoduleOutput)) {
        if ($null -ne $line -and -not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-Host ([string]$line)
        }
    }
    if ($exitCode -ne 0) {
        throw ("ESP-IDF submodule repair failed (exit {0})." -f $exitCode)
    }

    Add-SummaryLine 'ESP-IDF submodules: repaired'
}

function Get-PreferredInstalledIdfRoot {
    $candidate = Get-EspIdfCandidates | Select-Object -First 1
    if ($candidate) {
        return $candidate.RootPath
    }
    return ''
}

function Install-EspDrivers {
    param([Parameter(Mandatory = $true)][string]$EimExe)

    if (-not (Test-IsAdministrator)) {
        Write-Host 'Skipping ESP serial driver install because this window is not running as Administrator.' -ForegroundColor Yellow
        Add-SummaryLine 'ESP serial drivers: skipped (not running as Administrator)'
        return
    }

    Write-Host 'Installing ESP serial drivers...' -ForegroundColor Yellow
    & $EimExe install-drivers
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ("ESP serial driver installation failed (exit {0})." -f $exitCode)
    }

    Add-SummaryLine 'ESP serial drivers: installed'
}

function Write-SummaryFile {
    $lines = @(
        'Key Borrowing System - ESP-IDF Setup',
        ('Time: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
        ('Admin mode: {0}' -f $(if (Test-IsAdministrator) { 'Yes' } else { 'No' })),
        ''
    ) + @($summaryLines)

    $lines | Set-Content -Path $summaryFile -Encoding UTF8
}

$scriptExit = 0

try {
    Write-Host '============================================'
    Write-Host 'Key Borrowing System - ESP-IDF Setup'
    Write-Host '============================================'
    Write-Host ''
    Write-Host 'This helper is for PCs that will BUILD or FLASH the ESP firmware.'
    Write-Host 'It is separate from the normal app setup.'

    Add-SummaryLine ("Project root: {0}" -f $root)
    Add-SummaryLine ("ESP project: {0}" -f $espProjectDir)
    Add-SummaryLine ("Requested ESP-IDF version: {0}" -f $PreferredVersion)

    Write-Step 'Checking for an existing ESP-IDF installation...'
    $candidates = Get-EspIdfCandidates
    $verified = $null
    $detectedOnly = $null

    foreach ($candidate in $candidates) {
        if (-not $detectedOnly) {
            $detectedOnly = [PSCustomObject]@{
                Candidate = $candidate
                Success = $false
                Output = 'ESP-IDF export script detected, but idf.py verification did not finish in this shell.'
            }
        }
        $result = Test-EspIdfCandidate -Candidate $candidate
        if ($result.Success) {
            $verified = $result
            break
        }
    }

    if (-not $verified -and $InstallIfMissing) {
        Write-Step 'ESP-IDF was not detected. Installing the separate flashing toolchain...'
        $eimExe = Ensure-EimCli
        Add-SummaryLine ("EIM CLI: {0}" -f $eimExe)
        try {
            Install-EspIdfWithEim -EimExe $eimExe -Version $PreferredVersion
        } catch {
            $partialExport = Join-Path $env:USERPROFILE ("Espressif\{0}\esp-idf\export.ps1" -f $PreferredVersion)
            if (-not (Test-Path $partialExport)) {
                throw
            }
            Write-Host 'EIM reported an installation error, but ESP-IDF files are present. Finishing setup with ESP-IDF install.ps1...' -ForegroundColor Yellow
            Add-SummaryLine ("EIM warning: {0}" -f $_.Exception.Message)
        }
        Ensure-EspIdfPythonEnvironment -Version $PreferredVersion
        $installedRoot = Get-PreferredInstalledIdfRoot
        if ($installedRoot) {
            Ensure-EspIdfSubmodules -IdfRoot $installedRoot
        }
        if ($InstallDrivers) {
            Install-EspDrivers -EimExe $eimExe
        }

        $candidates = Get-EspIdfCandidates
        foreach ($candidate in $candidates) {
            if (-not $detectedOnly) {
                $detectedOnly = [PSCustomObject]@{
                    Candidate = $candidate
                    Success = $false
                    Output = 'ESP-IDF export script detected after install, but idf.py verification did not finish in this shell.'
                }
            }
            $result = Test-EspIdfCandidate -Candidate $candidate
            if ($result.Success) {
                $verified = $result
                break
            }
        }
    }

    if (-not $verified -and $detectedOnly) {
        $verified = $detectedOnly
    }

    if (-not $verified) {
        Add-SummaryLine 'ESP-IDF: not detected'
        Write-SummaryFile
        throw 'ESP-IDF was not detected. Run setup-esp-idf-for-flashing.bat to install it on this PC.'
    }

    Add-SummaryLine ("ESP-IDF export: {0}" -f $verified.Candidate.ExportPath)
    Add-SummaryLine ("ESP-IDF root: {0}" -f $verified.Candidate.RootPath)
    Add-SummaryLine ("ESP-IDF version hint: {0}" -f $(if ($verified.Candidate.Version) { $verified.Candidate.Version } else { 'unknown' }))
    if ($verified.Success) {
        Add-SummaryLine ("ESP-IDF verification: ready ({0})" -f $verified.Output)
    } else {
        Add-SummaryLine ("ESP-IDF verification: fallback detection only ({0})" -f $verified.Output)
    }

    Write-SummaryFile

    Write-Step 'ESP-IDF is ready for flashing on this PC.'
    Write-Host ("Export script: {0}" -f $verified.Candidate.ExportPath) -ForegroundColor Green
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Green
    Write-Host 'Next step for flashing:' -ForegroundColor Cyan
    Write-Host '1) Open hardware\esp32-locker-controller' -ForegroundColor Cyan
    Write-Host '2) Run: . <export.ps1>; idf.py -p COMx flash' -ForegroundColor Cyan
} catch {
    $scriptExit = 1
    Add-SummaryLine ("Error: {0}" -f $_.Exception.Message)
    Write-SummaryFile
    Write-Host ''
    Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host ("Summary saved to {0}" -f $summaryFile) -ForegroundColor Yellow
} finally {
    Write-Host ''
    Pause-IfNeeded
    exit $scriptExit
}
