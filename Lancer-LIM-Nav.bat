@echo off
rem Lance L!M VFR Nav sur cet ordinateur : double-cliquer sur ce fichier.
rem Ouvre l'application dans le navigateur ; fermer cette fenetre pour l'arreter.
rem Par defaut le GPS est SIMULE (un ordinateur n'a pas de vrai GPS) : un avion tourne autour de 46,6N 2,35E.
rem Option : "Lancer-LIM-Nav.bat gps-reel" utilise la position du navigateur (Wi-Fi, peu precise).
title L!M VFR Nav
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installer la version LTS depuis https://nodejs.org puis relancer.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere utilisation : installation des dependances, cela peut prendre plusieurs minutes...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue.
    pause
    exit /b 1
  )
)

echo.
echo Construction de l'application...
call npm run build -w @lim/app
if errorlevel 1 (
  echo La construction a echoue.
  pause
  exit /b 1
)

echo.
echo L!M VFR Nav demarre sur http://localhost:4173
echo Tout reste dans votre navigateur ; aucun fichier n'est envoye.
echo Pour arreter : fermer cette fenetre.
echo.

cd apps\app
if /i "%~1"=="gps-reel" (
  call npx vite preview --port 4173 --strictPort --open
) else (
  call npx vite preview --port 4173 --strictPort --open "/?sim"
)
pause
