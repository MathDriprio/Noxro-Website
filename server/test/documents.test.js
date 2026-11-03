import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { closeDb, loginAs, resetDb } from './helpers.js';

// PNG 1x1 valide
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const files = async (dir) => (await fs.readdir(dir)).filter((f) => !f.startsWith('.')); // ignore le dossier caché des vignettes

describe('documents', () => {
  let a;
  let b;
  let v;
  before(async () => {
    await resetDb();
    a = await loginAs('alice');
    b = await loginAs('bob');
    v = (await a.post('/api/vehicles').send({ make: 'BMW', model: 'E9' }).expect(201)).body.vehicle;
  });
  after(closeDb);

  it('envoie une photo liée à un véhicule, la sert, la définit en couverture', async () => {
    const up = await a.post('/api/documents').field('vehicleId', v.id).field('category', 'photo')
      .attach('files', PNG, { filename: 'été.png', contentType: 'image/png' }).expect(201);
    const doc = up.body.documents[0];
    assert.equal(doc.originalName, 'été.png');
    assert.equal(doc.mimeType, 'image/png');
    assert.equal(doc.isImage, true);
    assert.deepEqual(doc.links, [{ type: 'vehicle', id: v.id }]);

    const file = await b.get(doc.url).expect(200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['content-disposition'], /^inline/);
    assert.deepEqual(file.body, PNG);

    // 1ère photo = couverture par défaut
    assert.equal((await a.get(`/api/vehicles/${v.id}`)).body.vehicle.coverDocumentId, doc.id);
    const second = (await a.post('/api/documents').field('vehicleId', v.id).field('category', 'photo')
      .attach('files', PNG, 'b.png').expect(201)).body.documents[0];
    const r = await a.patch(`/api/vehicles/${v.id}`).send({ coverDocumentId: second.id }).expect(200);
    assert.equal(r.body.vehicle.coverDocumentId, second.id);
    const photos = (await a.get(`/api/documents?vehicleId=${v.id}&category=photo`).expect(200)).body.documents;
    assert.equal(photos.length, 2);
  });

  it('refuse de servir un faux fichier comme image/HTML (détection par signature)', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const up = (await a.post('/api/documents').field('vehicleId', v.id).field('category', 'photo')
      .attach('files', html, { filename: 'piege.png', contentType: 'image/png' }).expect(201)).body.documents[0];
    assert.equal(up.category, 'autre');
    assert.equal(up.isImage, false);
    const r = await a.get(up.url).expect(200);
    assert.match(r.headers['content-disposition'], /^attachment/);
    assert.equal(r.headers['content-type'], 'application/octet-stream');
  });

  it('document de facture lié à une transaction, retrouvable depuis le véhicule', async () => {
    const t = (await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Pièces', amount: 99 }).expect(201)).body.transaction;
    const d = (await a.post('/api/documents').field('transactionId', t.id).field('category', 'facture').field('title', 'Facture pièces')
      .attach('files', Buffer.from('%PDF-1.4 fake'), 'facture.pdf').expect(201)).body.documents[0];
    assert.equal(d.mimeType, 'application/pdf');
    assert.equal(t.documentCount, 0);
    assert.equal((await a.get(`/api/transactions/${t.id}`)).body.transaction.documentCount, 1);
    assert.equal((await a.get(`/api/documents?transactionId=${t.id}`)).body.documents.length, 1);
    assert.equal((await a.get(`/api/documents?vehicleId=${v.id}&include=children&category=facture`)).body.documents.length, 1);
    assert.equal((await a.get(`/api/documents?vehicleId=${v.id}&category=facture`)).body.documents.length, 0);
  });

  it('plusieurs liens, document général, et liens retirables', async () => {
    const general = (await a.post('/api/documents').attach('files', Buffer.from('hello'), 'notes.txt').expect(201)).body.documents[0];
    assert.deepEqual(general.links, []);
    assert.ok((await a.get('/api/documents?general=true')).body.documents.some((d) => d.id === general.id));
    await a.post(`/api/documents/${general.id}/links`).send({ vehicleId: v.id }).expect(200);
    await a.post(`/api/documents/${general.id}/links`).send({ userId: b.userId }).expect(200);
    const linked = (await a.get(`/api/documents/${general.id}`)).body.document;
    assert.equal(linked.links.length, 2);
    assert.equal((await a.get(`/api/documents?userId=${b.userId}`)).body.documents.length, 1);
    await a.delete(`/api/documents/${general.id}/links?userId=${b.userId}`).expect(200);
    await a.post(`/api/documents/${general.id}/links`).send({ vehicleId: v.id, userId: 1 }).expect(400);
  });

  it('valide l\'envoi : fichier requis, cible existante, taille max 30 Mo', async () => {
    await a.post('/api/documents').field('vehicleId', v.id).expect(400);
    await a.post('/api/documents').field('vehicleId', 99999).attach('files', PNG, 'x.png').expect(404);
    await a.post('/api/documents').field('vehicleId', v.id).field('taskId', 1).attach('files', PNG, 'x.png').expect(400);
    await a.post('/api/documents').field('category', 'nimporte').attach('files', PNG, 'x.png').expect(400);
    const big = Buffer.alloc(30 * 1024 * 1024 + 1);
    await a.post('/api/documents').field('vehicleId', v.id).attach('files', big, 'gros.bin').expect(413);
    // rien ne doit rester sur le disque après un rejet
    const dir = process.env.UPLOAD_DIR;
    const before = (await files(dir)).length;
    await a.post('/api/documents').field('vehicleId', 99999).attach('files', PNG, 'x.png').expect(404);
    assert.equal((await files(dir)).length, before);
  });

  it('documents d\'un véhicule supprimé masqués de la liste générale, visibles via le véhicule', async () => {
    const v2 = (await a.post('/api/vehicles').send({ make: 'Audi', model: 'TT' }).expect(201)).body.vehicle;
    const d = (await a.post('/api/documents').field('vehicleId', v2.id).attach('files', PNG, 'tt.png').expect(201)).body.documents[0];
    await a.delete(`/api/vehicles/${v2.id}`).expect(204);
    assert.ok(!(await a.get('/api/documents')).body.documents.some((x) => x.id === d.id));
    assert.ok((await a.get(`/api/documents?vehicleId=${v2.id}`)).body.documents.some((x) => x.id === d.id));
    await a.post('/api/documents').field('vehicleId', v2.id).attach('files', PNG, 'x.png').expect(409);
  });

  it('suppression : ligne et fichier disparaissent', async () => {
    const d = (await a.post('/api/documents').attach('files', Buffer.from('bye'), 'bye.txt').expect(201)).body.documents[0];
    const before = (await files(process.env.UPLOAD_DIR)).length;
    await b.delete(`/api/documents/${d.id}`).expect(204);
    assert.equal((await files(process.env.UPLOAD_DIR)).length, before - 1);
    await a.get(d.url).expect(404);
  });

  it('vignettes : WebP réduit, mis en cache, original intact, supprimé avec le document', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c33' } }).jpeg().toBuffer();
    const doc = (await a.post('/api/documents').field('vehicleId', v.id).field('category', 'photo')
      .attach('files', big, { filename: 'grande.jpg', contentType: 'image/jpeg' }).expect(201)).body.documents[0];
    assert.equal(doc.thumbUrl, `/api/documents/${doc.id}/thumb`);

    const small = await a.get(doc.thumbUrl).expect(200);
    assert.equal(small.headers['content-type'], 'image/webp');
    assert.match(small.headers['cache-control'], /immutable/);
    const meta = await sharp(small.body).metadata();
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 427);
    assert.ok(small.body.length < big.length / 10);

    const w1280 = await sharp((await a.get(`/api/documents/${doc.id}/thumb?w=1280`).expect(200)).body).metadata();
    assert.equal(w1280.width, 1280);
    // jamais agrandie : la vignette d'une petite image garde sa taille
    const tiny = (await a.post('/api/documents').attach('files', PNG, 'tiny.png').expect(201)).body.documents[0];
    assert.equal((await sharp((await a.get(tiny.thumbUrl).expect(200)).body).metadata()).width, 1);

    // l'original reste intact
    assert.deepEqual((await a.get(doc.url).expect(200)).body, big);

    // largeur hors liste, document non image, anonyme
    await a.get(`/api/documents/${doc.id}/thumb?w=100`).expect(400);
    const txt = (await a.post('/api/documents').attach('files', Buffer.from('hello'), 'n.txt').expect(201)).body.documents[0];
    assert.equal(txt.thumbUrl, null);
    await a.get(`/api/documents/${txt.id}/thumb`).expect(404);
    const { anon } = await import('./helpers.js');
    await anon().get(doc.thumbUrl).expect(401);

    // les vignettes sont retirées avec le document
    const thumbDir = path.join(process.env.UPLOAD_DIR, '.thumbs');
    assert.ok((await fs.readdir(thumbDir)).length >= 2);
    const before = (await fs.readdir(thumbDir)).length;
    await a.delete(`/api/documents/${doc.id}`).expect(204);
    assert.ok((await fs.readdir(thumbDir)).length < before);
  });

  it('image corrompue : la vignette retombe sur l\'original', async () => {
    // signature PNG valide mais contenu illisible
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pas une vraie image')]);
    const doc = (await a.post('/api/documents').attach('files', broken, { filename: 'casse.png', contentType: 'image/png' }).expect(201)).body.documents[0];
    const r = await a.get(doc.thumbUrl);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `/api/documents/${doc.id}/file`);
  });

  it('véhicule : coverThumbUrl pointe vers la vignette', async () => {
    const cover = (await a.get(`/api/vehicles/${v.id}`).expect(200)).body.vehicle;
    assert.match(cover.coverThumbUrl, /\/thumb$/);
    await a.get(cover.coverThumbUrl).expect(200);
  });
});
