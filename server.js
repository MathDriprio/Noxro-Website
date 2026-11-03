// Point d'entrée unique pour l'hébergeur : `node server.js`
// Lance l'API et sert le front compilé (client/dist). Variables : celles de server/.env (ou de l'hébergeur).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Les variables définies par l'hébergeur restent prioritaires sur server/.env
try { process.loadEnvFile(path.join(root, 'server/.env')); } catch { /* pas de fichier .env : on utilise l'environnement */ }

// Les chemins relatifs (UPLOAD_DIR=./uploads) sont relatifs à server/
process.chdir(path.join(root, 'server'));

const express = createRequire(path.join(root, 'server/package.json'))('express');
const { createApp } = await import('./server/src/app.js');
const { config } = await import('./server/src/config.js');
const { migrate } = await import('./server/src/db.js');

const applied = await migrate();
if (applied.length) console.log('Migrations appliquées :', applied.join(', '));

const app = createApp();

const dist = path.join(root, 'client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(config.port, () => console.log(`NoxroWebsite sur http://localhost:${config.port}`));
