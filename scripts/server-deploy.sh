#!/usr/bin/env bash
# Deploy ONLY the nearer Compose project. Never touches other stacks.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/regiuslab/nearer}"
PROJECT="${COMPOSE_PROJECT_NAME:-nearer}"
COMPOSE=(docker compose -p "$PROJECT" --project-directory "$DEPLOY_PATH")

cd "$DEPLOY_PATH"

if [[ ! -f docker-compose.yml || ! -f .env ]]; then
  echo "missing docker-compose.yml or .env in $DEPLOY_PATH" >&2
  exit 1
fi

# Refuse to run if someone pointed DEPLOY_PATH at another project by mistake.
case "$DEPLOY_PATH" in
  */nearer|*/nearer/) ;;
  *)
    echo "refusing deploy outside a nearer directory: $DEPLOY_PATH" >&2
    exit 1
    ;;
esac

echo "==> nearer deploy in $DEPLOY_PATH (project=$PROJECT)"
"${COMPOSE[@]}" config --quiet
# -p nearer scopes every command to this Compose project only.
# Never: compose down, system prune, or a path outside */nearer.
"${COMPOSE[@]}" pull || true
"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180

# Health inside the nearer frontend container only.
"${COMPOSE[@]}" exec -T frontend wget -qO- http://127.0.0.1/health
echo
"${COMPOSE[@]}" ps
echo "==> done (other Docker projects were not modified)"
