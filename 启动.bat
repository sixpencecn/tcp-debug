@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node launch.js
) else (
  "C:/Users/杨飞/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" launch.js
)
