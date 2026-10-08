@echo off
rem Starts the Surfaces manager and opens it in the default browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run manage
pause
