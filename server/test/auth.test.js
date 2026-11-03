import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { anon, app, closeDb, loginAs, makeInvitation, resetDb } from './helpers.js';

describe('authentification', () => {
  before(resetDb);
  after(closeDb);

  it('refuse l\'accès sans connexion', async () => {
    await anon().get('/api/vehicles').expect(401);
    await anon().get('/api/dashboard').expect(401);
    await anon().get('/api/documents/1/file').expect(401);
  });

  it('refuse un mauvais mot de passe', async () => {
    await loginAs('alice');
    const r = await anon().post('/api/auth/login').send({ email: 'alice@test.fr', password: 'faux' });
    assert.equal(r.status, 401);
    const r2 = await anon().post('/api/auth/login').send({ email: 'inconnu@test.fr', password: 'faux' });
    assert.equal(r2.status, 401);
    assert.equal(r.body.error.message, r2.body.error.message);
  });

  it('connecte puis déconnecte', async () => {
    const agent = await loginAs('bob');
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.displayName, 'bob');
    assert.equal(me.body.user.passwordHash, undefined);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('inscription par invitation, usage unique', async () => {
    const token = await makeInvitation();
    const body = { token, email: 'new@test.fr', displayName: 'Nouveau', password: 'supermotdepasse' };
    const agent = request.agent(app);
    await agent.get(`/api/auth/invitations/${token}`).expect(200);
    await agent.post('/api/auth/register').send({ ...body, password: 'court' }).expect(400);
    await agent.post('/api/auth/register').send(body).expect(201);
    await agent.get('/api/auth/me').expect(200);
    await anon().post('/api/auth/register').send({ ...body, email: 'autre@test.fr' }).expect(400);
    await anon().post('/api/auth/register').send({ ...body, token: 'bidon' }).expect(400);
  });

  it('invitation liée à un email', async () => {
    const token = await makeInvitation('precis@test.fr');
    await anon().post('/api/auth/register').send({ token, email: 'autre@test.fr', displayName: 'X', password: 'motdepasse1' }).expect(400);
    await anon().post('/api/auth/register').send({ token, email: 'precis@test.fr', displayName: 'X', password: 'motdepasse1' }).expect(201);
  });

  it('seul l\'admin crée des invitations', async () => {
    const user = await loginAs('simple');
    const admin = await loginAs('chef', { admin: true });
    await user.post('/api/admin/invitations').send({}).expect(403);
    const r = await admin.post('/api/admin/invitations').send({}).expect(201);
    await anon().get(`/api/auth/invitations/${r.body.token}`).expect(200);
    await user.get('/api/admin/logs').expect(403);
    await admin.get('/api/admin/logs').expect(200);
  });

  it('thème lié au compte : enregistré, validé, réinitialisable', async () => {
    const agent = await loginAs('styliste');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.user.theme, null);
    const r = await agent.patch('/api/users/me').send({ theme: 'raid' }).expect(200);
    assert.equal(r.body.user.theme, 'raid');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.user.theme, 'raid');
    // une nouvelle session (autre appareil) retrouve le thème
    const other = request.agent(app);
    const login = await other.post('/api/auth/login').send({ email: 'styliste@test.fr', password: 'motdepasse1' }).expect(200);
    assert.equal(login.body.user.theme, 'raid');
    // valeur inconnue refusée, thème des autres utilisateurs inchangé, changer de nom ne touche pas au thème
    const bad = await agent.patch('/api/users/me').send({ theme: 'rose-bonbon' }).expect(400);
    assert.ok(bad.body.error.fields.theme);
    await agent.patch('/api/users/me').send({ displayName: 'Styliste 2' }).expect(200);
    assert.equal((await agent.get('/api/auth/me')).body.user.theme, 'raid');
    const autre = await loginAs('autre');
    assert.equal((await autre.get('/api/auth/me')).body.user.theme, null);
    // retour au défaut
    assert.equal((await agent.patch('/api/users/me').send({ theme: null }).expect(200)).body.user.theme, null);
  });

  it('rejette une requête d\'une autre origine', async () => {
    const agent = await loginAs('csrf');
    await agent.post('/api/vehicles').set('Origin', 'http://evil.example').send({ make: 'A', model: 'B' }).expect(403);
  });
});
