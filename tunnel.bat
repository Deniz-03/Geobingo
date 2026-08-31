@echo off
title GeoBingo Tunnel - Adresse fuer deine Freunde
cd /d "%~dp0"

set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=C:\Program Files\cloudflared\cloudflared.exe"
if not exist "%CF%" (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   cloudflared wurde nicht gefunden.
    echo   Installieren mit:  winget install --id Cloudflare.cloudflared -e
    echo.
    pause
    exit /b 1
  )
  set "CF=cloudflared"
)

set PORT=8080
if not "%~1"=="" set PORT=%~1

echo.
echo  ============================================================
echo   Pruefe ob GeoBingo laeuft (Port %PORT%)...
echo  ============================================================

where curl.exe >nul 2>nul
if errorlevel 1 goto skipcheck

curl.exe -s -o NUL --max-time 4 "http://localhost:%PORT%/api/config"
if not errorlevel 1 goto ok
echo.
echo   GeoBingo laeuft nicht auf Port %PORT%.
echo   Bitte zuerst start.bat oeffnen und das Fenster offen lassen.
echo.
pause
exit /b 1

:skipcheck
echo   (curl nicht vorhanden - Pruefung uebersprungen)

:ok
echo.
echo  ============================================================
echo   Tunnel wird aufgebaut... das dauert ca. 10 Sekunden.
echo.
echo   Gleich erscheint unten eine Adresse wie:
echo       https://irgendwas-zufaelliges.trycloudflare.com
echo.
echo   DIESE Adresse schickst du deinen Freunden.
echo   Dieses Fenster muss offen bleiben - beim Schliessen
echo   ist die Adresse sofort tot.
echo  ============================================================
echo.

"%CF%" tunnel --url http://localhost:%PORT%

echo.
echo Tunnel beendet.
pause
