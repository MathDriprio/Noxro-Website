import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, loginAs, resetDb } from './helpers.js';

describe('véhicules', () => {
  let a;
  let b;
  before(async () => {
    await resetDb();
    a = await loginAs('alice');
    b = await loginAs('bob');
  });
  after(closeDb);

  it('crée un véhicule du garage (sans propriétaire)', async () => {
    const r = await a.post('/api/vehicles').send({ make: 'BMW', model: '2002 Turbo', year: 1974, plate: 'ab-123-cd' }).expect(201);
    assert.equal(r.body.vehicle.plate, 'AB123CD');
    assert.equal(r.body.vehicle.isGarage, true);
    assert.equal(r.body.vehicle.status, 'sur_place');
  });

  it('valide les champs et renvoie les erreurs par champ', async () => {
    const r = await a.post('/api/vehicles').send({ make: '', model: 'X', year: 1700, vin: '!!' }).expect(400);
    assert.ok(r.body.error.fields.make);
    assert.ok(r.body.error.fields.year);
    assert.ok(r.body.error.fields.vin);
    await a.post('/api/vehicles').send({ make: 'A', model: 'B', status: 'nimporte' }).expect(400);
  });

  it('refuse une plaque déjà utilisée par un véhicule actif', async () => {
    const r = await b.post('/api/vehicles').send({ make: 'Ford', model: 'Focus', plate: 'AB 123 CD' }).expect(409);
    assert.equal(r.body.error.code, 'plate_taken');
    assert.ok(r.body.error.fields.plate);
  });

  it('gère propriétaires multiples et changement en gardant l\'historique', async () => {
    const v = (await a.post('/api/vehicles').send({ make: 'Volvo', model: 'S60', ownerIds: [a.userId, b.userId] }).expect(201)).body.vehicle;
    assert.equal(v.owners.length, 2);
    const r = await a.put(`/api/vehicles/${v.id}/owners`).send({ userIds: [b.userId] }).expect(200);
    assert.deepEqual(r.body.vehicle.owners.map((o) => o.userId), [b.userId]);
    const detail = (await a.get(`/api/vehicles/${v.id}`).expect(200)).body;
    assert.equal(detail.ownerHistory.length, 2);
    assert.equal(detail.ownerHistory.filter((o) => o.until === null).length, 1);
    const back = await a.put(`/api/vehicles/${v.id}/owners`).send({ userIds: [] }).expect(200);
    assert.equal(back.body.vehicle.isGarage, true);
    await a.put(`/api/vehicles/${v.id}/owners`).send({ userIds: [9999] }).expect(400);
  });

  it('filtre par statut, propriétaire et recherche, avec compteurs', async () => {
    await a.post('/api/vehicles').send({ make: 'Peugeot', model: '205', status: 'en_vente', ownerIds: [a.userId] }).expect(201);
    const sale = await a.get('/api/vehicles?status=en_vente').expect(200);
    assert.equal(sale.body.vehicles.length, 1);
    const mine = await a.get('/api/vehicles?owner=me').expect(200);
    assert.deepEqual(mine.body.vehicles.map((v) => v.model), ['205']);
    const garage = await a.get('/api/vehicles?owner=garage').expect(200);
    assert.ok(garage.body.vehicles.every((v) => v.isGarage));
    const search = await a.get('/api/vehicles?q=ab-123').expect(200);
    assert.equal(search.body.vehicles.length, 1);
    const counts = (await a.get('/api/vehicles/counts').expect(200)).body;
    assert.equal(counts.all, 3);
    assert.equal(counts.en_vente, 1);
  });

  it('PATCH partiel ne touche pas aux champs absents', async () => {
    const v = (await a.post('/api/vehicles').send({ make: 'Audi', model: 'A4', plate: 'ZZ-999-ZZ', color: 'noir' }).expect(201)).body.vehicle;
    const r = await a.patch(`/api/vehicles/${v.id}`).send({ color: 'rouge' }).expect(200);
    assert.equal(r.body.vehicle.color, 'rouge');
    assert.equal(r.body.vehicle.plate, 'ZZ999ZZ');
    assert.equal(r.body.vehicle.make, 'Audi');
    await a.patch(`/api/vehicles/${v.id}`).send({ plate: 'AB-123-CD' }).expect(409);
    await a.patch(`/api/vehicles/${v.id}`).send({ inconnu: 1 }).expect(400);
  });

  it('suppression douce, liste des supprimés, restauration avec les données liées', async () => {
    const v = (await a.post('/api/vehicles').send({ make: 'Renault', model: '5', plate: 'RR-555-RR' }).expect(201)).body.vehicle;
    await a.post(`/api/vehicles/${v.id}/interventions`).send({ kind: 'entretien', title: 'Vidange', status: 'termine' }).expect(201);
    await a.post('/api/transactions').send({ vehicleId: v.id, label: 'Huile', amount: 42.5, category: 'piece' }).expect(201);
    await a.post('/api/tasks').send({ vehicleId: v.id, title: 'Changer filtre' }).expect(201);

    await b.delete(`/api/vehicles/${v.id}`).expect(204); // n'importe quel utilisateur
    assert.ok(!(await a.get('/api/vehicles').expect(200)).body.vehicles.some((x) => x.id === v.id));
    assert.ok((await a.get('/api/vehicles?deleted=true').expect(200)).body.vehicles.some((x) => x.id === v.id));
    assert.equal((await a.get('/api/transactions').expect(200)).body.transactions.filter((t) => t.vehicleId === v.id).length, 0);
    assert.equal((await a.get('/api/tasks').expect(200)).body.tasks.filter((t) => t.vehicleId === v.id).length, 0);
    // modifications bloquées tant que supprimé
    await a.patch(`/api/vehicles/${v.id}`).send({ color: 'x' }).expect(409);
    await a.post('/api/tasks').send({ vehicleId: v.id, title: 'x' }).expect(409);

    await a.post(`/api/vehicles/${v.id}/restore`).expect(200);
    const detail = (await a.get(`/api/vehicles/${v.id}`).expect(200)).body;
    assert.equal(detail.stats.interventions, 1);
    assert.equal(detail.stats.expenses, 42.5);
    assert.equal(detail.stats.openTasks, 1);
    assert.equal((await a.get('/api/transactions').expect(200)).body.transactions.filter((t) => t.vehicleId === v.id).length, 1);
    await a.post(`/api/vehicles/${v.id}/restore`).expect(409);
  });

  it('réutiliser la plaque d\'un véhicule supprimé le réactive (pas de doublon)', async () => {
    const v = (await a.post('/api/vehicles').send({ make: 'Fiat', model: 'Panda', plate: 'FP-111-FP' }).expect(201)).body.vehicle;
    await a.post(`/api/tasks`).send({ vehicleId: v.id, title: 'Garder' }).expect(201);
    await a.delete(`/api/vehicles/${v.id}`).expect(204);
    const r = await b.post('/api/vehicles').send({ make: 'Fiat', model: 'Panda 4x4', plate: 'fp 111 fp', color: 'vert' }).expect(200);
    assert.equal(r.body.reactivated, true);
    assert.equal(r.body.vehicle.id, v.id);
    assert.equal(r.body.vehicle.model, 'Panda 4x4');
    assert.equal(r.body.vehicle.deletedAt, null);
    assert.equal((await a.get(`/api/vehicles/${v.id}`)).body.stats.openTasks, 1);
  });

  it('404 sur véhicule inconnu, 400 sur id invalide', async () => {
    await a.get('/api/vehicles/99999').expect(404);
    await a.get('/api/vehicles/abc').expect(400);
  });
});
