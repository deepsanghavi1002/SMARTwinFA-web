#!/bin/sh
# The one backup job for every client on this host. Each client keeps its own PostgreSQL; this job asks each
# <client>-db container for a compressed dump and keeps it in /backups/<client>/ (one file a day, BACKUP_KEEP_DAYS days).
#   backup.sh loop        nightly at BACKUP_HOUR (24h clock), for every running client
#   backup.sh now <id>    one dump of one client right now (the control panel's "Backup now")
set -u
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

# The client ids of this host: every <id>-db container that carries the smartwinfa.client label and is not an on-prem site.
clients() {
  docker ps --filter label=smartwinfa.client --filter status=running \
    --format '{{.Label "smartwinfa.client"}}	{{.Label "smartwinfa.site"}}	{{.Names}}' |
    awk -F '\t' '$3 == $1 "-db" && $2 == "" { print $1 }' | sort -u
}

dump() {
  id="$1"; name="$2"
  dir="/backups/$id"; mkdir -p "$dir"
  file="$dir/$name.dump"
  if docker exec "$id-db" pg_dump --format=custom -U smartwinfa_web -d smartwin_data_intake > "$file.part" && [ -s "$file.part" ]; then
    mv "$file.part" "$file"
    echo "backup: done $id $name $(du -h "$file" | cut -f1)"
  else
    rm -f "$file.part"
    echo "backup: ERROR pg_dump failed for $id"
    return 1
  fi
}

case "${1:-loop}" in
  now)
    id="${2:-}"
    case "$id" in ""|*[!a-z0-9-]*) echo "backup: usage: backup.sh now <client id>"; exit 2 ;; esac
    dump "$id" "manual-$(date +%F-%H%M)" && echo "/backups/$id/manual-$(date +%F-%H%M).dump" ;;
  loop)
    echo "backup: every client's database at $BACKUP_HOUR:00, kept $BACKUP_KEEP_DAYS days"
    while true; do
      if [ "$(date +%H)" -eq "$BACKUP_HOUR" ]; then
        for id in $(clients); do
          [ -f "/backups/$id/$(date +%F).dump" ] || dump "$id" "$(date +%F)"
          find "/backups/$id" -name '*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
        done
      fi
      sleep 300
    done ;;
  *) echo "backup: usage: backup.sh loop | now <client id>"; exit 2 ;;
esac
