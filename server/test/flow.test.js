import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, loginAs, resetDb } from './helpers.js';

describe('entretiens, transactions, tâches, commentaires', () => {
  let a;
  let b;
  let v;
  before(async () => {
    await resetDb();
    a = await loginAs('alice');
    b = await loginAs('bob');
    v = (await a.post('/api/vehicles').send({ make: 'Peugeot', model: '307', plate: 'EM-307-EM' }).expect(201)).body.vehicle;
  });
  after(closeDb);

  it('intervention planifiée : date obligatoire', async () => {
    const r = await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'reparation', title: 'Embrayage', status: 'planifie' }).expect(400);
    assert.ok(r.body.error.fields.plannedDate);
    const ok = await a.post(`/api/vehicles/${v.id}/interventions`)
      .send({ kind: 'reparation', category: 'embrayage', title: 'Embrayage', plannedDate: '2026-12-19' }).expect(201);
    assert.equal(ok.body.intervention.status, 'planifie');
  });

  it('passer à terminé renseigne la date, planifié sans date refusé en PATCH', async () => {
    const i = (await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'entretien', title: 'Vidange', status: 'en_cours' }).expect(201)).body.intervention;
    const done = (await a.patch(`/api/interventions/${i.id}`).send({ status: 'termine' }).expect(200)).body.intervention;
    assert.match(done.doneDate, /^\d{4}-\d{2}-\d{2}$/);
    await a.patch(`/api/interventions/${i.id}`).send({ status: 'planifie' }).expect(400);
    await a.patch(`/api/interventions/${i.id}`).send({ status: 'planifie', plannedDate: '2027-01-01' }).expect(200);
  });

  it('transactions : montants, lien intervention, total de coût', async () => {
    const i = (await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'reparation', title: 'Freins', status: 'en_cours' }).expect(201)).body.intervention;
    await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Plaquettes', amount: 0 }).expect(400);
    await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Plaquettes', amount: 10.005 }).expect(400);
    await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Plaquettes', amount: 'abc' }).expect(400);
    // véhicule déduit de l'intervention
    const t = (await a.post('/api/transactions').send({ interventionId: i.id, label: 'Plaquettes', amount: 59.9, category: 'piece' }).expect(201)).body.transaction;
    assert.equal(t.vehicleId, v.id);
    assert.equal(t.amount, 59.9);
    await a.post('/api/transactions').send({ interventionId: i.id, label: 'Disques', amount: 80.1, category: 'piece' }).expect(201);
    await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Remboursement', amount: 20, direction: 'revenu' }).expect(201);
    const got = (await a.get(`/api/interventions/${i.id}`).expect(200)).body.intervention;
    assert.equal(got.totalCost, 140);
    const list = (await a.get(`/api/transactions?vehicleId=${v.id}`).expect(200)).body;
    assert.equal(list.totals.expenses, 140);
    assert.equal(list.totals.revenue, 20);
    assert.equal(list.totals.net, -120);
    // intervention d'un autre véhicule
    const other = (await a.post('/api/vehicles').send({ make: 'X', model: 'Y' }).expect(201)).body.vehicle;
    await a.post('/api/transactions').send({ vehicleId: other.id, interventionId: i.id, label: 'z', amount: 1 }).expect(400);
  });

  it('transaction générale du garage (sans véhicule)', async () => {
    const t = (await a.post('/api/transactions').send({ label: 'Loyer garage', amount: 300, category: 'frais_garage' }).expect(201)).body.transaction;
    assert.equal(t.vehicleId, null);
    const general = (await a.get('/api/transactions?general=true').expect(200)).body;
    assert.deepEqual(general.transactions.map((x) => x.id), [t.id]);
    const patched = (await a.patch(`/api/transactions/${t.id}`).send({ vehicleId: v.id }).expect(200)).body.transaction;
    assert.equal(patched.vehicleId, v.id);
    await b.delete(`/api/transactions/${t.id}`).expect(204);
    await a.get(`/api/transactions/${t.id}`).expect(404);
  });

  it('tâches : filtres, assignation, tri', async () => {
    await a.post('/api/tasks').send({ vehicleId: v.id, title: 'Acheter pièces', assigneeId: 9999 }).expect(400);
    const t1 = (await a.post('/api/tasks').send({ vehicleId: v.id, title: 'CT', dueDate: '2026-12-01', priority: 'haute', assigneeId: b.userId }).expect(201)).body.task;
    await a.post('/api/tasks').send({ title: 'Nettoyer le garage' }).expect(201);
    assert.equal(t1.assigneeName, 'bob');
    assert.equal((await a.get('/api/tasks?general=true').expect(200)).body.tasks.length, 1);
    assert.equal((await b.get('/api/tasks?assigneeId=me').expect(200)).body.tasks.length, 1);
    await a.patch(`/api/tasks/${t1.id}`).send({ status: 'fait' }).expect(200);
    assert.equal((await a.get('/api/tasks?status=open').expect(200)).body.tasks.some((t) => t.id === t1.id), false);
  });

  it('commentaires : un seul parent, édition réservée à l\'auteur', async () => {
    const c = (await a.post('/api/comments').send({ vehicleId: v.id, body: 'Belle voiture' }).expect(201)).body.comment;
    await a.post('/api/comments').send({ vehicleId: v.id, taskId: 1, body: 'x' }).expect(400);
    await a.post('/api/comments').send({ body: 'x' }).expect(400);
    await a.post('/api/comments').send({ vehicleId: v.id, body: '   ' }).expect(400);
    await a.post('/api/comments').send({ vehicleId: 99999, body: 'x' }).expect(404);
    await b.patch(`/api/comments/${c.id}`).send({ body: 'piraté' }).expect(403);
    await b.delete(`/api/comments/${c.id}`).expect(403);
    const edited = (await a.patch(`/api/comments/${c.id}`).send({ body: 'Très belle' }).expect(200)).body.comment;
    assert.equal(edited.body, 'Très belle');
    const list = (await b.get(`/api/comments?vehicleId=${v.id}`).expect(200)).body.comments;
    assert.equal(list.length, 1);
    assert.equal(list[0].authorName, 'alice');
    await a.get('/api/comments').expect(400);
    await a.delete(`/api/comments/${c.id}`).expect(204);
  });

  it('supprimer une intervention garde ses transactions mais les détache', async () => {
    const i = (await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'entretien', title: 'Pneus', status: 'en_cours' }).expect(201)).body.intervention;
    const t = (await a.post('/api/transactions').send({ interventionId: i.id, label: 'Pneus x4', amount: 400 }).expect(201)).body.transaction;
    await a.delete(`/api/interventions/${i.id}`).expect(204);
    const after = (await a.get(`/api/transactions/${t.id}`).expect(200)).body.transaction;
    assert.equal(after.interventionId, null);
    assert.equal(after.vehicleId, v.id);
  });

  it('tableau de bord', async () => {
    const d = (await a.get('/api/dashboard').expect(200)).body;
    assert.ok(Array.isArray(d.inProgress));
    assert.ok(d.inProgress.some((x) => x.id === v.id));
    assert.ok(d.upcoming.length >= 1);
    assert.equal(d.stats.vehicles, 2);
  });

  it('calendrier : événements d\'une période (interventions planifiées + tâches non faites)', async () => {
    const inRange = (await a.get('/api/calendar?from=2026-12-01&to=2026-12-31').expect(200)).body.events;
    assert.ok(inRange.some((e) => e.type === 'intervention' && e.title === 'Embrayage' && e.date === '2026-12-19'));
    assert.ok(inRange.every((e) => e.date >= '2026-12-01' && e.date <= '2026-12-31'));
    assert.deepEqual(inRange.map((e) => e.date), [...inRange.map((e) => e.date)].sort());
    // la tâche "CT" (2026-12-01) est faite : absente ; terminé/annulé jamais listés
    assert.ok(!inRange.some((e) => e.type === 'task' && e.title === 'CT'));
    assert.equal((await a.get('/api/calendar?from=2030-01-01&to=2030-01-31').expect(200)).body.events.length, 0);
    await a.get('/api/calendar?from=2026-01-01&to=2027-12-31').expect(400);
    await a.get('/api/calendar?from=2026-12-31&to=2026-12-01').expect(400);
    await a.get('/api/calendar').expect(400);
  });

  it('journal interne alimenté', async () => {
    const admin = await loginAs('chef', { admin: true });
    const logs = (await admin.get('/api/admin/logs?limit=500').expect(200)).body.logs;
    assert.ok(logs.some((l) => l.entity_type === 'vehicle' && l.action === 'create' && l.user_name === 'alice'));
    assert.ok(logs.some((l) => l.entity_type === 'transaction' && l.action === 'delete'));
  });
});
