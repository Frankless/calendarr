#!/bin/sh
# Calendarr starts as root only to hand the /config folder over to the
# PUID:PGID user, then drops root privileges.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
mkdir -p "${CONFIG_DIR:-/config}"

if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" "${CONFIG_DIR:-/config}" 2>/dev/null \
    || echo "Warning: could not give ${CONFIG_DIR:-/config} to $PUID:$PGID"
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
  fi
  echo "Warning: setpriv not found, Calendarr is running as root"
fi
exec "$@"
