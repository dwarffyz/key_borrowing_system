@echo off
setlocal
cd /d "%~dp0"

set "PS1=%~dp0stop-cloudflare-tunnel.ps1"
if not exist "%PS1%" (
  echo ERROR: Missing script: %PS1%
  pause
  exit /b 1
)

if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" goto run_winps
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" goto run_winps_sysnative
where /q pwsh.exe && goto run_pwsh

echo ERROR: PowerShell not found.
echo Please install Windows PowerShell or PowerShell 7 (pwsh) then try again.
pause
exit /b 1

:run_winps
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:run_winps_sysnative
"%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:run_pwsh
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:done
set "EXITCODE=%ERRORLEVEL%"
exit /b %EXITCODE%
