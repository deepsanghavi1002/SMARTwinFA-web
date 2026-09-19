# SMARTwinFA macOS launcher

This package installs a small SMARTwinFA macOS application that opens the
public hosted prototype. It does **not** install PostgreSQL or copy any
customer data onto the Mac.

## Install

1. Extract the ZIP file.
2. Double-click `Install-SMARTwinFA.command`.
3. SMARTwinFA is copied to `~/Applications` and a Desktop icon is created.
4. Open **SMARTwinFA** from the Desktop or Applications folder.

The launcher opens `https://smart-winfa.deepsanghavi.org/`. If Google Chrome
is installed, it opens in an app-style window; otherwise it opens in the
default browser. Updates are delivered by the hosted web application, so the
launcher does not need to be reinstalled after normal releases.

To remove only the launcher, run `Uninstall-SMARTwinFA.command`. It does not
remove the hosted app or any database data.
