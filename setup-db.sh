#!/usr/bin/env bash
# Crée la vraie base PostgreSQL (utilisateur + base de dev + base de tests), met à jour server/.env
# et .env.test, puis applique les migrations. À lancer UNE fois, dans ton terminal (sudo demande ton mot de passe).
set -euo pipefail
cd "$(dirname "$0")"

DB_USER=mathias
DB_NAME=noxrowebsite
DB_TEST=noxro_test

read -r -s -p "Choisis un mot de passe pour l'utilisateur PostgreSQL '$DB_USER' : " PW; echo
[ -n "$PW" ] || { echo "Mot de passe vide." >&2; exit 1; }

sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$PW" -v u="$DB_USER" -v db="$DB_NAME" -v dbtest="$DB_TEST" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'u', :'pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'u') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'u', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''', :'db', :'u')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''', :'dbtest', :'u')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbtest') \gexec
SQL

# Écrit les URLs de connexion (mot de passe encodé pour l'URL) sans l'afficher
PW="$PW" python3 - "$DB_USER" "$DB_NAME" "$DB_TEST" <<'PY'
import os, re, sys
from urllib.parse import quote
user, db, test = sys.argv[1:4]
pw = quote(os.environ["PW"], safe="")

def set_var(path, key, value):
    lines = open(path).read().splitlines() if os.path.exists(path) else []
    out, done = [], False
    for l in lines:
        if re.match(rf"^{key}=", l):
            out.append(f"{key}={value}"); done = True
        else:
            out.append(l)
    if not done:
        out.append(f"{key}={value}")
    open(path, "w").write("\n".join(out) + "\n")

set_var("server/.env", "DATABASE_URL", f"postgres://{user}:{pw}@localhost:5432/{db}")
set_var("server/.env.test", "DATABASE_URL", f"postgres://{user}:{pw}@localhost:5432/{test}")
PY
chmod 600 server/.env server/.env.test

echo "Création des tables…"
(cd server && npm run --silent migrate)

echo
echo "Base prête. Crée maintenant ton compte administrateur :"
echo "  cd server && npm run create-admin -- ton@mail.fr 'Ton Nom' 'ton-mot-de-passe'"
echo "Puis relance le site avec ./start.sh"
