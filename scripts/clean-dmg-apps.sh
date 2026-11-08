#!/bin/sh
# Al crear el .dmg, macOS monta un disco temporal (/Volumes/dmg.XXXX) y registra la copia
# de Tasky que contiene. El disco se desmonta, pero el registro queda y la app aparece
# repetida en Apps/Launchpad. Este script borra esos registros huérfanos.
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSR" ] || exit 0

"$LSR" -dump 2>/dev/null \
  | sed -nE 's#^path: +(/Volumes/dmg\.[^/]+/Tasky\.app) \(0x[0-9a-f]+\)$#\1#p' \
  | while read -r app; do
      "$LSR" -u "$app" && echo "registro temporal quitado: $app"
    done
exit 0
