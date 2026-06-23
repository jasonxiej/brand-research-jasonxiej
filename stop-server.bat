@echo off
chcp 65001 >nul
title {YOUR_BRAND} 品牌调研中心 · 停止服务

REM ============================================================
REM   {YOUR_BRAND} Brand Research Hub · 停止脚本
REM   关闭 8000 端口上所有 Python http.server 进程
REM ============================================================

setlocal

echo.
echo ============================================================
echo   正在停止 {YOUR_BRAND} 品牌调研中心...
echo ============================================================
echo.

set PORT=8000
set FOUND=0

REM 通过端口找进程
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [+] 关闭 PID %%P ...
    taskkill /F /PID %%P >nul 2>&1
    set FOUND=1
)

REM 同时关闭可能存在的 python.exe 残留
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Brand Research*" >nul 2>&1
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Brand Research*" >nul 2>&1

if "%FOUND%"=="1" (
    echo.
    echo [OK] 服务已停止
) else (
    echo [-] 没有运行中的服务
)

echo.
pause
endlocal
