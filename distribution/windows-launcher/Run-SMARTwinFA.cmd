@echo off
setlocal
set "APP_URL=http://pinas.local:4173/"
set "EDGE_64=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_32=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE_64%" (
  start "SMARTwinFA" "%EDGE_64%" --app="%APP_URL%" --start-maximized
  exit /b 0
)

if exist "%EDGE_32%" (
  start "SMARTwinFA" "%EDGE_32%" --app="%APP_URL%" --start-maximized
  exit /b 0
)

start "SMARTwinFA" "%APP_URL%"
