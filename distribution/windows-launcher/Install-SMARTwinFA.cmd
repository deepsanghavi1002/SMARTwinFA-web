@echo off
setlocal
set "APP_NAME=SMARTwinFA"
set "INSTALL_DIR=%LOCALAPPDATA%\SMARTwinFA"
set "DESKTOP_LINK=%USERPROFILE%\Desktop\SMARTwinFA.lnk"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0Run-SMARTwinFA.cmd" "%INSTALL_DIR%\Run-SMARTwinFA.cmd" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%DESKTOP_LINK%'); $shortcut.TargetPath = '%INSTALL_DIR%\Run-SMARTwinFA.cmd'; $shortcut.WorkingDirectory = '%INSTALL_DIR%'; $shortcut.IconLocation = $env:SystemRoot + '\System32\SHELL32.dll,14'; $shortcut.Description = 'Open SMARTwinFA from the local Pi server'; $shortcut.Save()"

echo.
echo SMARTwinFA is installed.
echo Double-click the SMARTwinFA icon on the Desktop to open it.
echo.
pause
