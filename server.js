// Point d'entrée unique pour l'hébergeur : `node server.js`
// Lance l'API et sert le front compilé (client/dist). Variables : celles de server/.env (ou de l'hébergeur).
// Écrit en CommonJS (sans await de haut niveau) pour fonctionner aussi via tsx.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = __dirname;
const load = (file) => import(pathToFileURL(path.join(root, file)).href);

async function main() {
  // Les variables définies par l'hébergeur restent prioritaires sur server/.env
  try { process.loadEnvFile(path.join(root, 'server/.env')); } catch { /* pas de .env : on utilise l'environnement */ }

  // Les chemins relatifs (UPLOAD_DIR=./uploads) sont relatifs à server/
  process.chdir(path.join(root, 'server'));

  const express = require(path.join(root, 'server/node_modules/express'));
  const { createApp } = await load('server/src/app.js');
  const { config } = await load('server/src/config.js');
  const { migrate } = await load('server/src/db.js');

  const applied = await migrate();
  if (applied.length) console.log('Migrations appliquées :', applied.join(', '));

  const app = createApp();
  const dist = path.join(root, 'client/dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

  app.listen(config.port, () => console.log(`NoxroWebsite sur http://localhost:${config.port}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
