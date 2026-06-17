$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

Set-Location $Root

if (Test-Path (Join-Path $Root '.git')) {
    git pull --ff-only
}

npm install --no-fund --no-audit
Push-Location (Join-Path $Root 'public')
try {
    npm install --no-fund --no-audit
} finally {
    Pop-Location
}

Write-Host 'Update complete.' -ForegroundColor Green

