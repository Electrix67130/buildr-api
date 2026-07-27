#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Buildr (production).
#
# Fait un pg_dump depuis le service db (conteneur buildr-db) vers ./backups/, compresse,
# et supprime les sauvegardes de plus de RETENTION_DAYS jours.
#
# Installation du cron (tous les jours a 3h du matin) :
#   crontab -e
#   0 3 * * * cd /chemin/vers/buildr-api && ./scripts/backup-db.sh >> ./backups/backup.log 2>&1
#
# Restauration :
#   gunzip -c backups/buildr-YYYY-MM-DD_HHhMM.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T db \
#     psql -U "$DB_USER" -d "$DB_NAME"

set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
BACKUP_DIR="./backups"

# Se placer a la racine du projet (dossier parent de scripts/)
cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[backup] $ENV_FILE introuvable — abandon." >&2
  exit 1
fi

# Charger DB_USER / DB_NAME depuis .env.production
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%Hh%M)"
OUTFILE="$BACKUP_DIR/buildr-${TIMESTAMP}.sql.gz"

echo "[backup] $(date) — dump de la base '$DB_NAME'..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$OUTFILE"

echo "[backup] OK -> $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"

# Rotation
DELETED="$(find "$BACKUP_DIR" -name 'buildr-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
echo "[backup] Rotation : $DELETED sauvegarde(s) > ${RETENTION_DAYS}j supprimee(s)."
