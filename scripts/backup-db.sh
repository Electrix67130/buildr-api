#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Buildr (production).
#
# Fait un pg_dump depuis le service db (conteneur buildr-db) vers ./backups/, compresse,
# l'envoie sur le stockage objet, et supprime les sauvegardes locales de plus de
# RETENTION_DAYS jours.
#
# L'envoi hors du serveur est le coeur du dispositif : une copie posee a cote de
# la base ne protege de rien. Une panne de disque emporterait la base ET ses
# sauvegardes. Il n'est pas bloquant — si le bucket est injoignable, la copie
# locale existe quand meme et le script se termine en succes avec un
# avertissement.
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

# Envoi hors du serveur. Le script tourne dans le conteneur de l'API, ou le SDK
# S3 et les identifiants sont deja disponibles : aucune cle a dupliquer sur
# l'hote. Le dump passe par stdin, le conteneur ne voyant pas ./backups.
if [[ "${STORAGE_MODE:-local}" == "s3" ]]; then
  REMOTE_KEY="${BACKUP_S3_PREFIX:-backups}/$(basename "$OUTFILE")"
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
       node scripts/upload-backup.js "$REMOTE_KEY" < "$OUTFILE"; then
    :
  else
    # Volontairement non bloquant : mieux vaut une sauvegarde locale seule qu'un
    # cron en echec qu'on finit par ignorer.
    echo "[backup] ATTENTION : envoi distant echoue — seule la copie locale existe." >&2
  fi
else
  echo "[backup] STORAGE_MODE != s3 — pas d'envoi distant."
fi

# Rotation locale. Les copies distantes ne sont pas supprimees ici : la cle d'API
# n'a deliberement pas le droit de supprimer un objet. Leur expiration se regle
# par une regle de cycle de vie sur le bucket (cf. docs/HOSTING.md).
DELETED="$(find "$BACKUP_DIR" -name 'buildr-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
echo "[backup] Rotation : $DELETED sauvegarde(s) > ${RETENTION_DAYS}j supprimee(s)."
