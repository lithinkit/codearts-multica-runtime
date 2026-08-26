@echo off
rem Translate protocol family args to codearts-runtime args
rem Also handles extra operations from various protocol families

setlocal

set "MODE=%1"

if "%MODE%"=="probe" (
    node "%~dp0dist\src\index.js" --probe
    exit /b %errorlevel%
)

if "%MODE%"=="list-models" (
    node "%~dp0dist\src\index.js" --list-models
    exit /b %errorlevel%
)

if "%MODE%"=="run" (
    node "%~dp0dist\src\index.js" --stdio
    exit /b %errorlevel%
)

rem Fallback 1: pass through as-is (supports --probe, --list-models, --stdio)
if "%MODE%"=="--probe" (
    node "%~dp0dist\src\index.js" --probe
    exit /b %errorlevel%
)
if "%MODE%"=="--list-models" (
    node "%~dp0dist\src\index.js" --list-models
    exit /b %errorlevel%
)
if "%MODE%"=="--stdio" (
    node "%~dp0dist\src\index.js" --stdio
    exit /b %errorlevel%
)

rem Fallback 2: unknown operation — emit valid JSON and exit 0
rem Protocol families may run extra operations (config locate, model list, etc.)
echo {}
exit /b 0