#!/bin/sh
# Instala (o actualiza) Tasky en /Applications a partir de la última compilación.
# Uso: npm run install:mac   (compila y luego ejecuta este script)
set -e

cd "$(dirname "$0")/.."
APP="$PWD/src-tauri/target.noindex/release/bundle/macos/Tasky.app"
DEST="/Applications/Tasky.app"
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [ ! -d "$APP" ]; then
  echo "No encuentro $APP. Compila primero con: npm run build:app" >&2
  exit 1
fi

if pgrep -f "/Tasky.app/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Tasky está abierta. Ciérrala (⌘Q) y vuelve a ejecutar este comando." >&2
  exit 1
fi

rm -rf "$DEST"
ditto "$APP" "$DEST"

# Una sola Tasky registrada: la de /Applications.
"$LSR" -u "$APP" >/dev/null 2>&1 || true
"$LSR" -f "$DEST"
sh scripts/clean-dmg-apps.sh

echo "Tasky instalada en $DEST"
