@echo off
REM ============================================================
REM   {YOUR_BRAND} Brand Research Hub - Startup Script
REM   English only to avoid GBK/UTF-8 codepage issues.
REM   Run this by double-clicking, or from cmd / PowerShell.
REM ============================================================

REM Switch to the directory this batch file lives in.
cd /d "%~dp0"

set PORT=8000

echo.
echo ============================================================
echo   {YOUR_BRAND} Brand Research Hub - Node backend starting
echo ============================================================
echo.

REM 1) Kill any old process holding port 8000
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [!] Port %PORT% is busy, killing old process...
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%P >nul 2>&1
    )
    timeout /t 1 >nul
)

REM 2) Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [X] Node.js not found. Please install Node 18+ from https://nodejs.org/
    echo     Make sure to check "Add to PATH" during installation.
    echo.
    pause
    exit /b 1
)

REM 3) First-run: install dependencies
if not exist "node_modules" (
    echo [+] First run, installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [X] npm install failed.
        pause
        exit /b 1
    )
    echo.
)

REM 4) Check .env
if not exist ".env" (
    echo.
    echo [Reminder] .env not found.
    echo            Please copy .env.example to .env and fill in your API key:
    echo                copy .env.example .env
    echo            Then open .env with Notepad and set MINIMAX_API_KEY.
    echo.
    echo            Without a key the page will load but the "Research" button will fail.
    echo.
    timeout /t 3 >nul
)

REM 5) Detect local IP (display only). Honor HOST env var if user pinned a specific IP.
if defined HOST (
    set "BIND_HOST=%HOST%"
) else (
    set "BIND_HOST=0.0.0.0"
)

set "LOCAL_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=*" %%i in ("%%a") do (
        set "LOCAL_IP=%%i"
        goto :got_ip
    )
)
:got_ip
if "%LOCAL_IP%"=="" set "LOCAL_IP=127.0.0.1"

REM 如果用户用 LAN_HOST 钉死了 IP，覆盖探测结果
if defined LAN_HOST (
    set "LOCAL_IP=%LAN_HOST%"
)

REM Decide which URL to open in browser:
REM   - If user pinned HOST (e.g. 192.168.1.100), open that
REM   - Otherwise open the LAN IP (so phone/tablet on same Wi-Fi can use it too)
if /i "%BIND_HOST%"=="0.0.0.0" (
    set "OPEN_URL=http://%LOCAL_IP%:%PORT%/"
) else if /i "%BIND_HOST%"=="127.0.0.1" (
    set "OPEN_URL=http://localhost:%PORT%/"
) else (
    set "OPEN_URL=http://%BIND_HOST%:%PORT%/"
)

echo.
echo ============================================================
echo   Service started:
echo.
echo     Local    : http://localhost:%PORT%/
echo     Local    : http://127.0.0.1:%PORT%/
echo     LAN      : http://%LOCAL_IP%:%PORT%/
if /i not "%BIND_HOST%"=="0.0.0.0" if /i not "%BIND_HOST%"=="127.0.0.1" (
    echo     Pinned   : http://%BIND_HOST%:%PORT%/   ^<-- HOST env var
)
if defined LAN_HOST (
    echo     LAN_HOST : %LAN_HOST%   ^<-- IP pinned via LAN_HOST
)
echo.
echo   Opening in browser: %OPEN_URL%
echo   Other devices on the same Wi-Fi can use the LAN URL above.
echo   To pin a specific IP, set HOST or LAN_HOST before running, e.g.:
echo       set LAN_HOST=192.168.1.100 ^&^& start-server.bat
echo.
echo   Press Ctrl+C to stop the service.
echo ============================================================
echo.

REM 6) Open browser automatically (use LAN URL by default)
start "" "%OPEN_URL%"

REM 7) Start Node backend in foreground
set HOST=%BIND_HOST%
node server.mjs
