#!/bin/sh
# Calendarr démarre en root uniquement pour donner le dossier /config à
# l'utilisateur PUID:PGID, puis abandonne les droits root.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
mkdir -p "${CONFIG_DIR:-/config}"

if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" "${CONFIG_DIR:-/config}" 2>/dev/null \
    || echo "Avertissement : impossible de donner ${CONFIG_DIR:-/config} à $PUID:$PGID"
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
  fi
  echo "Avertissement : setpriv introuvable, Calendarr tourne en root"
fi
exec "$@"
