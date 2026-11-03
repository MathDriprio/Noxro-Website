import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { anon, closeDb, loginAs, resetDb } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('historique d\'un véhicule', () => {
  let a;
  let b;
  let v;
  let other;
  before(async () => {
    await resetDb();
    a = await loginAs('alice');
    b = await loginAs('bob');
    v = (await a.post('/api/vehicles').send({ make: 'Volvo', model: 'XC70', ownerIds: [a.userId] }).expect(201)).body.vehicle;
    other = (await a.post('/api/vehicles').send({ make: 'Ford', model: 'Focus' }).expect(201)).body.vehicle;
  });
  after(closeDb);

  it('rassemble interventions, dépenses, tâches, documents, commentaires et propriétaires', async () => {
    const i = (await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'reparation', title: 'Embrayage', status: 'termine', doneDate: '2026-10-02' }).expect(201)).body.intervention;
    const t = (await b.post('/api/transactions').send({ interventionId: i.id, label: 'Kit embrayage', amount: 189.9, category: 'piece', occurredOn: '2026-10-01' }).expect(201)).body.transaction;
    await a.post('/api/tasks').send({ vehicleId: v.id, title: 'Nettoyage', dueDate: '2026-12-20' }).expect(201);
    await a.post('/api/comments').send({ interventionId: i.id, body: 'Embrayage changé, tout roule.' }).expect(201);
    await a.post('/api/comments').send({ vehicleId: v.id, body: 'Belle voiture' }).expect(201);
    // facture liée à la dépense (donc au véhicule), photo directe, document d'une AUTRE voiture
    await a.post('/api/documents').field('transactionId', t.id).field('category', 'facture').attach('files', Buffer.from('%PDF-1.4 x'), 'facture.pdf').expect(201);
    await a.post('/api/documents').field('vehicleId', v.id).field('category', 'photo').attach('files', PNG, 'photo.png').expect(201);
    await a.post('/api/documents').field('vehicleId', other.id).attach('files', PNG, 'autre.png').expect(201);
    await a.post('/api/tasks').send({ vehicleId: other.id, title: 'Tâche du Focus' }).expect(201);

    const { events, truncated } = (await a.get(`/api/vehicles/${v.id}/history`).expect(200)).body;
    assert.equal(truncated, false);
    const types = events.map((e) => e.type);
    for (const t2 of ['vehicle', 'owner', 'intervention', 'transaction', 'task', 'document', 'comment']) assert.ok(types.includes(t2), `manque ${t2}`);

    // rien d'une autre voiture
    assert.ok(!events.some((e) => e.title === 'Tâche du Focus' || e.originalName === 'autre.png'));

    // la facture de la dépense et le commentaire de l'intervention remontent avec leur contexte
    const facture = events.find((e) => e.originalName === 'facture.pdf');
    assert.deepEqual(facture.on, { kind: 'transaction', title: 'Kit embrayage' });
    assert.equal(facture.isImage, false);
    const photo = events.find((e) => e.originalName === 'photo.png');
    assert.equal(photo.isImage, true);
    assert.equal(photo.thumbUrl, `/api/documents/${photo.id}/thumb`);
    assert.equal(events.find((e) => e.type === 'comment' && e.on).on.title, 'Embrayage');
    assert.equal(events.find((e) => e.type === 'intervention').cost, 189.9);
    assert.equal(events.find((e) => e.type === 'transaction').actor, 'bob');
    assert.equal(events.find((e) => e.type === 'owner').title, 'alice devient propriétaire');
  });

  it('trié du plus récent (ou prévu) au plus ancien', async () => {
    const dates = (await a.get(`/api/vehicles/${v.id}/history`).expect(200)).body.events.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(dates[0], '2026-12-20'); // la tâche à venir est en tête
  });

  it('une tâche terminée est datée de sa réalisation ; un ancien propriétaire génère 2 événements', async () => {
    const task = (await a.post('/api/tasks').send({ vehicleId: v.id, title: 'Faite', dueDate: '2020-01-01' }).expect(201)).body.task;
    await a.patch(`/api/tasks/${task.id}`).send({ status: 'fait' }).expect(200);
    await a.put(`/api/vehicles/${v.id}/owners`).send({ userIds: [b.userId] }).expect(200);
    const { events } = (await a.get(`/api/vehicles/${v.id}/history`).expect(200)).body;
    const done = events.find((e) => e.title === 'Faite');
    assert.equal(done.status, 'fait');
    assert.notEqual(done.date, '2020-01-01');
    assert.ok(events.some((e) => e.title === 'alice n\'est plus propriétaire'));
    assert.ok(events.some((e) => e.title === 'bob devient propriétaire'));
  });

  it('accessible pour un véhicule supprimé ; 404 inconnu ; 401 anonyme', async () => {
    const tmp = (await a.post('/api/vehicles').send({ make: 'Fiat', model: 'Panda' }).expect(201)).body.vehicle;
    await a.delete(`/api/vehicles/${tmp.id}`).expect(204);
    const r = await a.get(`/api/vehicles/${tmp.id}/history`).expect(200);
    assert.equal(r.body.events[0].type, 'vehicle');
    await a.get('/api/vehicles/99999/history').expect(404);
    await anon().get(`/api/vehicles/${v.id}/history`).expect(401);
  });
});
