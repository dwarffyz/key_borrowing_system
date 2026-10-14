@echo off
setlocal
title Key Borrowing System - ESP32 One-Click Flash
color 0F
set SCRIPT_DIR=%~dp0
echo.
echo  ======================================================
echo    Key Borrowing System - ESP32 One-Click Flash
echo  ======================================================
echo  Detecting the connected ESP32 automatically...
echo  Build and upload progress will appear below.
echo.
call "%SCRIPT_DIR%flash-esp32-controller.bat"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" echo. & echo  Flash did not finish. Read the error above, then run this file again.
endlocal & exit /b %EXIT_CODE%
