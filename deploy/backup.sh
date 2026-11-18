#!/bin/sh
set -eu
mkdir -p "${1:-./backups}"
file="${1:-./backups}/knockout-$(date -u +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U knockout -d knockout -Fc > "$file"
echo "Backup saved: $file"
