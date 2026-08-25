# SMARTwinFA Windows launcher

This is a small Windows installer for the Pi-hosted SMARTwinFA prototype. It
does **not** install PostgreSQL, copy customer data, or modify the Pi.

## Install on a Windows PC

1. Connect the PC to the same network as the Pi.
2. Copy this complete `windows-launcher` folder to the PC.
3. Double-click `Install-SMARTwinFA.cmd` and approve the normal Windows prompt
   if it appears.
4. Double-click the new **SMARTwinFA** desktop icon.

The icon launches Microsoft Edge in app mode at `http://pinas.local:4173/`.
All application updates remain on the Pi, so the desktop launcher does not
need to be reinstalled after normal web releases.

If the Pi cannot be reached, first confirm that the PC is on the same network
and then open `http://pinas.local:4173/` in Edge to diagnose name resolution.

To remove only the local launcher, run `Uninstall-SMARTwinFA.cmd`. It never
removes the Pi service or any database data.
