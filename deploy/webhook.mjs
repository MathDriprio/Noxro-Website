// Récepteur du webhook GitHub : vérifie la signature, puis lance deploy.sh quand master reçoit un push.
// Écoute en local (nginx fait le proxy de /hooks/github). Secret dans WEBHOOK_SECRET.
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('WEBHOOK_SECRET manquant');
const port = Number(process.env.WEBHOOK_PORT ?? 9000);
const deployScript = process.env.DEPLOY_SCRIPT ?? '/opt/noxro/deploy/deploy.sh';
const branch = process.env.DEPLOY_BRANCH ?? 'master';

let running = false;
let queued = false;

function deploy() {
  if (running) { queued = true; return; }
  running = true;
  const child = spawn('bash', [deployScript], { stdio: 'inherit' });
  child.on('close', (code) => {
    console.log(`Déploiement terminé (code ${code})`);
    running = false;
    if (queued) { queued = false; deploy(); }
  });
}

function validSignature(body, header = '') {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/hooks/github') { res.writeHead(404).end(); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 1_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!validSignature(body, req.headers['x-hub-signature-256'])) { res.writeHead(401).end('signature invalide'); return; }
    const event = req.headers['x-github-event'];
    if (event === 'ping') { res.writeHead(200).end('pong'); return; }
    if (event !== 'push') { res.writeHead(202).end('événement ignoré'); return; }
    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400).end('JSON invalide'); return; }
    if (payload.ref !== `refs/heads/${branch}`) { res.writeHead(202).end('branche ignorée'); return; }
    console.log(`Push sur ${branch} par ${payload.pusher?.name ?? '?'} : déploiement`);
    deploy();
    res.writeHead(202).end('déploiement lancé');
  });
}).listen(port, '127.0.0.1', () => console.log(`Webhook sur 127.0.0.1:${port}`));
