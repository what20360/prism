@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 LTS or newer first.
  pause
  exit /b 1
)
if not exist node_modules\ws\package.json (
  call npm ci --omit=dev
  if errorlevel 1 exit /b 1
)
node dist-server/server.mjs
pause
