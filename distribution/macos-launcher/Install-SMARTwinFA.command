#!/bin/zsh

set -eu

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
APPLICATIONS_DIR="$HOME/Applications"
APP_PATH="$APPLICATIONS_DIR/SMARTwinFA.app"
DESKTOP_LINK="$HOME/Desktop/SMARTwinFA.app"

mkdir -p "$APPLICATIONS_DIR"
rm -rf "$APP_PATH"
ditto "$SOURCE_DIR/SMARTwinFA.app" "$APP_PATH"
ln -sfn "$APP_PATH" "$DESKTOP_LINK"
open "$APP_PATH"

echo "SMARTwinFA was installed in $APPLICATIONS_DIR and linked on the Desktop."
