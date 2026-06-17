@echo off
setlocal
set SCRIPT_DIR=%~dp0
set POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
if not exist "%POWERSHELL_EXE%" set POWERSHELL_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe
if not exist "%POWERSHELL_EXE%" set POWERSHELL_EXE=powershell.exe
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-esp-idf-for-flashing.ps1" -InstallIfMissing
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
