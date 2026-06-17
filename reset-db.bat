@echo off
setlocal
cd /d %~dp0

echo ============================================
echo Key Borrowing System - Reset Test Data
echo ============================================
echo.
echo This will DELETE:
echo - All teacher/user accounts
echo - All activity logs, transactions, feedback, and QR codes
echo.
echo This will ALSO:
echo - Reset ALL keys to AVAILABLE (keeps keys/lockers)
echo - Keep ONLY the default admin account from public\.env
echo.
echo Tip: Stop the server first before running this.
echo.
choice /M "Continue"
if errorlevel 2 (
    echo Cancelled.
    exit /b 0
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ❌ Node.js is not installed or not in PATH.
    echo Install Node.js v16+ from: https://nodejs.org/
    pause
    exit /b 1
)

echo.
node public\server\scripts\reset-db.js --mode test --yes --confirm RESET_DATABASE
if %errorlevel% neq 0 (
    echo.
    echo ❌ Reset failed.
    pause
    exit /b 1
)

echo.
echo ✅ Reset completed.
pause

