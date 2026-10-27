@echo off
cd /d "%~dp0"
REM 优先使用自带运行时 node.exe（无需在系统安装 Node）
if exist "%~dp0node.exe" (
  "%~dp0node.exe" launch.js
) else (
  node launch.js
)
