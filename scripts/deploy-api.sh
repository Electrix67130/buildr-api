#!/usr/bin/env bash
# Deploiement de l'API Buildr sur le VPS. Lance par GitHub Actions en SSH
# (cf. .github/workflows/deploy.yml) OU a la main.
#
# Sur le VPS, lier ce script depuis le home du user de deploiement :
#   ln -sf /home/buildr/api/scripts/deploy-api.sh /home/buildr/deploy-api.sh
#
# Usage : deploy-api.sh [ref]   (ref = tag de version, ex 1.0.0, ou 'master')
#
# Tout le corps est dans main() : le script se met a jour lui-meme (git pull)
# pendant qu'il tourne, or bash relit le fichier au fil de l'execution. Sans
# cette fonction, il reprend a un mauvais offset et execute des bouts de
# l'ancienne version. Une fonction est parsee en entier avant d'etre appelee.

set -euo pipefail

main() {
  local REF="${1:-master}"
  local APP_DIR="/home/buildr/api"
  local COMPOSE="docker compose -f docker-compose.prod.yml"

  cd "$APP_DIR"

  echo "[deploy] Recuperation du code (ref: $REF)..."
  git fetch --all --tags --prune
  git checkout "$REF"
  # Sur une branche (master), on avance au dernier commit. Sur un tag (HEAD
  # detache), le checkout suffit — pas de pull.
  if git symbolic-ref -q HEAD >/dev/null; then
    git pull --ff-only origin "$REF"
  fi

  echo "[deploy] Build de l'image API..."
  $COMPOSE build api

  echo "[deploy] Migrations..."
  $COMPOSE run --rm api npm run migrate

  # On ne demarre que l'API et la base : la vitrine et le dashboard sont
  # deployes separement (scripts/deploy-web.sh) et leurs repos ne sont pas
  # forcement presents a cote de celui-ci.
  echo "[deploy] Demarrage de l'API et de la base..."
  $COMPOSE up -d api db

  echo "[deploy] Nettoyage des images orphelines..."
  docker image prune -f

  echo "[deploy] OK — ref $REF deployee."
}

main "$@"
