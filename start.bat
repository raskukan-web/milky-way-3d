@echo off
setlocal
rem ================================================================
rem  Milky Way planetarium launcher (Chrome / Edge, WebGL2).
rem  No dependencies: the app is plain local HTML/JS files.
rem  NOTE: keep this file pure ASCII - cmd.exe misparses UTF-8 batch files.
rem ================================================================
set "HERE=%~dp0"
set "PAGE=%HERE%index.html"
set "URL=file:///%PAGE:\=/%"
set "PROFILE=%TEMP%\milkyway_planetarium_profile"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER goto fallback

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --ignore-gpu-blocklist --enable-gpu-rasterization --force_high_performance_gpu --start-maximized --app="%URL%"
exit /b 0

:fallback
echo Chrome / Edge not found - opening index.html with the default browser...
start "" "%PAGE%"
exit /b 0
