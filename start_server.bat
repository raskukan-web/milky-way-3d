@echo off
setlocal
rem ================================================================
rem  Alternative launch via a local HTTP server (if the browser blocks
rem  file:// pages). Requires Python 3. Keep this file pure ASCII.
rem ================================================================
cd /d "%~dp0"
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py -3"
if not defined PY goto nopy
echo Server: http://localhost:8765  (close this window to stop)
start "" "http://localhost:8765/index.html"
%PY% -m http.server 8765 --bind 127.0.0.1
exit /b 0

:nopy
echo Python 3 not found. Use start.bat (no server needed) or install Python from python.org
pause
exit /b 1
