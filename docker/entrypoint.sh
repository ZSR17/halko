#!/bin/sh
# Runs Halko as PUID:PGID (default 1000, the first user of most Linux hosts), owner of the data folder,
# so a folder mounted from the host stays readable by its user.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  # Only when it is not theirs yet: going through a large media folder takes a while.
  if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ]; then
    chown -R "$PUID:$PGID" "$DATA_DIR" || echo "Could not give $DATA_DIR to $PUID:$PGID, it must be writable by them."
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi
# Already started as a given user (docker run --user): as it is.
exec "$@"
