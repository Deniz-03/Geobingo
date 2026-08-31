@echo off
title GeoBingo Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js ist nicht installiert.
  echo   Bitte von https://nodejs.org herunterladen und installieren.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo Installiere Abhaengigkeiten...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Installation fehlgeschlagen.
    pause
    exit /b 1
  )
)

node server/index.js
echo.
echo Server beendet.
pause
