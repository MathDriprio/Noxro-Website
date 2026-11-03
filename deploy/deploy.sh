#!/usr/bin/env bash
# Met à jour le site depuis GitHub (master), recompile le front et redémarre l'API.
# Utilisé à la main (`noxro-deploy`) et par le webhook. Le corps est entre accolades : bash le lit en entier
# avant de l'exécuter, donc le `git reset` ci-dessous peut remplacer ce fichier sans casser l'exécution.
{
  set -euo pipefail
  cd /opt/noxro
  git fetch -q origin master
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] && [ "${1:-}" != "--force" ]; then
    echo "Déjà à jour ($(git rev-parse --short HEAD))."
    exit 0
  fi
  git reset -q --hard origin/master
  npm install --silent --prefix server
  (cd client && npm install --silent && npm run build)
  chown -R noxro:noxro /opt/noxro
  systemctl restart noxro
  sleep 2
  systemctl is-active --quiet noxro
  echo "Déployé : $(git log -1 --format='%h %s')"
  exit 0
}
