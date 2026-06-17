$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$targets = @(
    (Join-Path $Root 'node_modules'),
    (Join-Path $Root 'public\node_modules'),
    (Join-Path $Root '.tools')
)

foreach ($target in $targets) {
    if (Test-Path $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

Write-Host 'Removed npm packages and local runtime logs.' -ForegroundColor Green
Write-Host 'public\.env and MongoDB data were kept for safety.' -ForegroundColor Yellow

