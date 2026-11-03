#!/usr/bin/env bash
# Lance l'API (port 3001) et le front (port 5173) en mode développement. Ctrl+C arrête tout.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f server/.env ]; then
  echo "server/.env introuvable : copie server/.env.example en server/.env et renseigne DATABASE_URL." >&2
  exit 1
fi

for dir in server client; do
  [ -d "$dir/node_modules" ] || (echo "Installation des dépendances de $dir…" && cd "$dir" && npm install)
done

# Vérifie que PostgreSQL répond avant de lancer l'API
DB_URL=$(grep -E '^DATABASE_URL=' server/.env | cut -d= -f2-)
if command -v pg_isready >/dev/null && ! pg_isready -q -d "$DB_URL"; then
  echo "PostgreSQL ne répond pas pour : $DB_URL" >&2
  echo "Vérifie que le service tourne (sudo systemctl start postgresql) et que DATABASE_URL est correcte." >&2
  exit 1
fi

trap 'kill 0' EXIT INT TERM

(cd server && npm run dev) &
(cd client && npm run dev -- --host) &

echo
echo "Site : http://localhost:5173   (API : http://localhost:3001)"
wait
