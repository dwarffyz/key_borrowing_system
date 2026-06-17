@echo off
setlocal
cd /d "%~dp0"

set "PS1=%~dp0start-local-system.ps1"
if not exist "%PS1%" (
  echo ERROR: Missing launcher script: %PS1%
  pause
  exit /b 1
)

if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
  exit /b %ERRORLEVEL%
)

if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" (
  "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
  exit /b %ERRORLEVEL%
)

where /q pwsh.exe
if not errorlevel 1 (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
  exit /b %ERRORLEVEL%
)

echo ERROR: PowerShell was not found on this computer.
pause
exit /b 1
