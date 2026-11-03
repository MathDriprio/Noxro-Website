# NoxroWebsite

Gestion collaborative d'un garage : véhicules, entretiens/réparations, dépenses, documents, tâches, commentaires.

- `server/` : API Node 22 + Express + PostgreSQL (tests : `npm test`)
- `client/` : React + Vite

## Installation (dev)

```bash
./setup-db.sh      # crée l'utilisateur + les bases PostgreSQL (dev et tests), écrit server/.env, applique les migrations
cd server && npm run create-admin -- toi@mail.fr "Ton Nom" 'un-mot-de-passe'   # 8 caractères min., entre apostrophes
cd .. && ./start.sh                     # API :3001 + site :5173
```

Inviter un ami : `npm run invite -- [email]` (dans `server/`) affiche un lien `/inscription/<jeton>` valable 7 jours.
L'admin peut aussi créer des invitations via `POST /api/admin/invitations` et lire le journal via `GET /api/admin/logs`.

## Tests

`server/.env.test` pointe vers une base dédiée (`noxro_test`), **vidée à chaque lancement** : ne jamais la faire pointer vers la vraie base.

```bash
sudo -u postgres psql -c "CREATE DATABASE noxro_test OWNER noxro;"
cd server && npm test
```

## Déploiement (VPS Debian)

- `npm run build` dans `client/` → servir `client/dist` avec nginx, et proxy `/api` vers `127.0.0.1:3001`.
- nginx doit transmettre `Host` (`proxy_set_header Host $host;`), `client_max_body_size 31m;`, HTTPS obligatoire.
- `server/.env` : `PRODUCTION=true` (cookies `secure`, `trust proxy`), `UPLOAD_DIR` hors du dépôt (à sauvegarder avec la base).
- Lancer l'API avec systemd (`npm start`).

## Choix fonctionnels notables

- Suppression d'un véhicule = masquage (`deleted_at`) ; ses données restent en base et reviennent à la restauration.
  Réutiliser l'immatriculation d'un véhicule supprimé le réactive au lieu de créer un doublon.
- Propriétaires : table d'historique (`since` / `until`) ; aucun propriétaire actuel = véhicule du garage.
- Documents/commentaires : rattachés à exactement un élément par lien (véhicule, intervention, transaction, tâche, utilisateur ; document pour les commentaires).
  Un document sans lien est un document général du garage. Types affichables détectés par signature du fichier.
- Montants stockés en centimes ; transactions et tâches sans véhicule = frais/tâches généraux du garage.
- Commentaires : modifiables par leur auteur, supprimables par l'auteur ou l'admin.

## Thèmes

Le bouton « Thème » de la barre de navigation change l'apparence (mémorisée dans le navigateur). Les thèmes sont des blocs
`:root[data-theme='...']` en tête de `client/src/styles.css` (couleurs) + une image `client/public/backgrounds/<id>.jpg`
(2560×1440, 16:9) et sa miniature `<id>-thumb.jpg`. Pour en ajouter un : copier un bloc, ajouter l'entrée dans `client/src/theme.js`
et déposer les deux images. Crédits des photos : `client/public/backgrounds/CREDITS.md`.

## Vignettes des images

Les listes affichent des vignettes WebP (320 / 640 / 1280 / 1920 px de large) générées à la demande par `sharp` et mises en cache dans
`<UPLOAD_DIR>/.thumbs/` ; les originaux ne sont jamais modifiés (carrousel : version 1920 px + lien « Original »).
Ce dossier est **reconstructible** : inutile de le sauvegarder (supprimer `.thumbs/` est sans risque, les vignettes se régénèrent).
`sharp` embarque ses binaires pour Linux x64 (Debian inclus) ; sur un VPS ARM, `npm install` télécharge la variante adaptée.
