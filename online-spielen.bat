@echo off
title GeoBingo Starter
cd /d "%~dp0"

echo.
echo  ============================================================
echo    GeoBingo - Online mit Freunden
echo  ============================================================
echo.
echo   Es oeffnen sich gleich ZWEI Fenster:
echo     1) GeoBingo Server
echo     2) GeoBingo Tunnel  - dort steht die Adresse fuer deine Freunde
echo.
echo   BEIDE muessen offen bleiben, solange ihr spielt.
echo.

echo  [1/2] Server wird gestartet...
start "GeoBingo Server" "%~dp0start.bat"

where curl.exe >nul 2>nul
if errorlevel 1 goto blindwait

echo        warte bis er bereit ist...
set /a tries=0
:wait
set /a tries+=1
curl.exe -s -o NUL --max-time 3 "http://localhost:8080/api/config"
if not errorlevel 1 goto ready
if %tries% GEQ 25 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:failed
echo.
echo   Der Server ist nicht hochgekommen.
echo   Schau ins Server-Fenster, dort steht die Fehlermeldung.
echo.
pause
exit /b 1

:blindwait
echo        warte 8 Sekunden...
ping -n 9 127.0.0.1 >nul

:ready
echo        Server laeuft.
echo.
echo  [2/2] Tunnel wird gestartet...
start "GeoBingo Tunnel" "%~dp0tunnel.bat"

echo.
echo  ============================================================
echo   Fertig. Im Tunnel-Fenster erscheint nach ein paar Sekunden
echo   eine Adresse wie
echo       https://irgendwas.trycloudflare.com
echo   Die schickst du deinen Freunden.
echo.
echo   Du selbst spielst am besten ueber:  http://localhost:8080
echo  ============================================================
echo.
echo  Dieses Fenster schliesst sich gleich von selbst.
ping -n 16 127.0.0.1 >nul
