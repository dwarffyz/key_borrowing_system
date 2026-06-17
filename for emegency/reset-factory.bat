@echo off
setlocal
set PROJECT_ROOT=%~dp0..

if not exist "%PROJECT_ROOT%\reset-factory.bat" (
    echo ERROR: Could not find "%PROJECT_ROOT%\reset-factory.bat"
    pause
    exit /b 1
)

call "%PROJECT_ROOT%\reset-factory.bat" %*
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
