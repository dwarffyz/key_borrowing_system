[CmdletBinding()]
param(
    [ValidateRange(10, 180)]
    [int]$WaitTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root 'docker-compose.yml'
$ContainerName = 'key-borrowing-mongodb'

function Test-CommandSuccess {
    param([string]$FilePath, [string[]]$Arguments)

    try {
        & $FilePath @Arguments *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $ComposeFile)) {
    throw "Docker Compose file not found: $ComposeFile"
}

if (-not (Test-CommandSuccess -FilePath 'docker' -Arguments @('version', '--format', '{{.Server.Version}}'))) {
    throw 'Docker Desktop (or Docker Engine) is not running. Start it, then run this script again.'
}

if (-not (Test-CommandSuccess -FilePath 'docker' -Arguments @('compose', 'version'))) {
    throw 'Docker Compose v2 is required. Update Docker Desktop, then run this script again.'
}

Write-Host 'Starting MongoDB Docker container...' -ForegroundColor Cyan
& docker compose --project-directory $Root -f $ComposeFile up --detach mongodb
if ($LASTEXITCODE -ne 0) {
    throw 'Docker could not start MongoDB.'
}

$deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
do {
    $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerName 2>$null | Select-Object -First 1).Trim()
    if ($health -eq 'healthy') {
        Write-Host 'MongoDB is healthy at mongodb://localhost:27017' -ForegroundColor Green
        exit 0
    }
    if ($health -eq 'unhealthy' -or $health -eq 'exited' -or $health -eq 'dead') {
        throw "MongoDB container is $health. Run: docker compose logs mongodb"
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

throw "MongoDB did not become healthy within $WaitTimeoutSeconds seconds. Run: docker compose logs mongodb"
