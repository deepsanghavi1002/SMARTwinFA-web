@echo off
setlocal
set "INSTALL_DIR=%LOCALAPPDATA%\SMARTwinFA"
set "DESKTOP_LINK=%USERPROFILE%\Desktop\SMARTwinFA.lnk"

if exist "%DESKTOP_LINK%" del /Q "%DESKTOP_LINK%"
if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"

echo SMARTwinFA launcher removed. The Pi-hosted application and its data were not changed.
pause
