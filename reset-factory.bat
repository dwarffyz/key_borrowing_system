@echo off
setlocal
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set MODE=factory
set DRY_RUN=0
if /I "%~1"=="--dry-run" set DRY_RUN=1
if /I "%~1"=="-DryRun" set DRY_RUN=1

echo ============================================
echo Key Borrowing System - FACTORY RESET
echo ============================================
echo.

if not exist "public\server\scripts\reset-db.js" (
    echo ERROR: reset-db.js was not found from this folder.
    echo Make sure you run this from the project root or use the wrapper inside "for emegency".
    pause
    exit /b 1
)

if %DRY_RUN%==1 (
    echo DRY RUN ONLY.
    echo No data will be deleted.
    echo.
) else (
    echo WARNING: This is a FULL WIPE.
    echo It will delete users, logs, transactions, feedback, QR codes,
    echo AND it will delete ALL keys/lockers then recreate the default set.
    echo.
    echo It will keep ONLY the default admin account from public\.env.
    echo.
    echo Tip: Stop the server first before running this.
    echo.
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is not installed or not in PATH.
    echo Run setup.bat first on this PC.
    pause
    exit /b 1
)

if %DRY_RUN%==0 (
    choice /M "Continue"
    if errorlevel 2 (
        echo Cancelled.
        exit /b 0
    )
)

echo.
if %DRY_RUN%==1 (
    node public\server\scripts\reset-db.js --mode factory --dry-run
) else (
    node public\server\scripts\reset-db.js --mode factory --yes --confirm RESET_DATABASE
)

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Factory reset failed.
    pause
    exit /b 1
)

echo.
if %DRY_RUN%==1 (
    echo Factory reset dry run completed.
) else (
    echo Factory reset completed.
)
pause
