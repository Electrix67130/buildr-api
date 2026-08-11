#!/usr/bin/env bash
# Deploiement de la vitrine (getbuildr.fr) et du dashboard (app.getbuildr.fr)
# sur le VPS. Les deux vivent dans des repos separes, clones a cote de l'API :
#
#   /home/buildr/api        <- repo buildr-api (porte docker-compose.prod.yml)
#   /home/buildr/website    <- repo buildr-website
#   /home/buildr/dashboard  <- repo buildr-dashboard
#
# Le script clone les repos manquants au premier passage.
#
# Sur le VPS, lier ce script depuis le home du user de deploiement :
#   ln -sf /home/buildr/api/scripts/deploy-web.sh /home/buildr/deploy-web.sh
#
# Usage : deploy-web.sh [cible]
#   deploy-web.sh            -> vitrine + dashboard
#   deploy-web.sh website    -> vitrine seule
#   deploy-web.sh dashboard  -> dashboard seul

set -euo pipefail

TARGET="${1:-all}"
API_DIR="/home/buildr/api"
BASE_DIR="$(dirname "$API_DIR")"
COMPOSE="docker compose -f docker-compose.prod.yml"

case "$TARGET" in
  all) SERVICES=(website dashboard) ;;
  website) SERVICES=(website) ;;
  dashboard) SERVICES=(dashboard) ;;
  *)
    echo "[deploy-web] Cible inconnue : $TARGET (attendu : all, website, dashboard)" >&2
    exit 1
    ;;
esac

# Nom du repo GitHub correspondant a chaque service.
repo_for() {
  case "$1" in
    website) echo "buildr-website" ;;
    dashboard) echo "buildr-dashboard" ;;
  esac
}

for service in "${SERVICES[@]}"; do
  dir="$BASE_DIR/$service"
  repo="$(repo_for "$service")"

  if [ -d "$dir/.git" ]; then
    echo "[deploy-web] $service : mise a jour du code..."
    git -C "$dir" fetch --all --prune
    git -C "$dir" pull --ff-only origin main
  else
    echo "[deploy-web] $service : premier clone..."
    git clone "git@github.com:Electrix67130/$repo.git" "$dir"
  fi
done

cd "$API_DIR"

# Le dashboard inline API_KEY et l'URL de l'API dans son bundle au build :
# il faut que .env soit lisible ici (interpolation docker compose).
if [ ! -f "$API_DIR/.env" ]; then
  echo "[deploy-web] .env introuvable dans $API_DIR" >&2
  exit 1
fi

echo "[deploy-web] Build des images (${SERVICES[*]})..."
$COMPOSE build "${SERVICES[@]}"

echo "[deploy-web] Demarrage..."
$COMPOSE up -d "${SERVICES[@]}"

echo "[deploy-web] Nettoyage des images orphelines..."
docker image prune -f

echo "[deploy-web] OK — ${SERVICES[*]} deploye(s)."
