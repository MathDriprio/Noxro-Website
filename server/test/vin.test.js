import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { decodeVin, decodeVinFull } from '../src/vin.js';
import { closeDb, loginAs, resetDb } from './helpers.js';

// VIN de test : WMI + 6 caractères neutres + code année (10e) + 7 caractères de série
const vin = (wmi, year = 'S') => `${wmi}ZZZZZZ${year}A000001`;

describe('décodage VIN', () => {
  it('reconnaît le constructeur par le WMI', () => {
    assert.equal(decodeVin(vin('VF3')).make, 'Peugeot');
    assert.equal(decodeVin(vin('VF1')).make, 'Renault');
    assert.equal(decodeVin(vin('WBA')).make, 'BMW');
    assert.equal(decodeVin(vin('YV1')).make, 'Volvo');
    assert.equal(decodeVin(vin('JTD')).make, 'Toyota'); // préfixe à 2 caractères
    assert.equal(decodeVin(vin('JTH')).make, 'Lexus'); // le WMI exact prime
  });

  it('normalise la saisie (minuscules, espaces, tirets)', () => {
    const r = decodeVin('wvw zzz-1jzxw000001');
    assert.equal(r.valid, true);
    assert.equal(r.vin, 'WVWZZZ1JZXW000001');
    assert.equal(r.make, 'Volkswagen');
  });

  it('années candidates : cycle de 30 ans, sans futur ni avant 1981', () => {
    assert.deepEqual(decodeVin(vin('VF3', 'X')).yearCandidates, [1999]); // 2029 est dans le futur
    assert.deepEqual(decodeVin(vin('VF3', 'S')).yearCandidates, [1995, 2025]);
    assert.deepEqual(decodeVin(vin('VF3', '1')).yearCandidates, [2001]);
    assert.deepEqual(decodeVin(vin('VF3', 'A')).yearCandidates, [2010]); // 1980 est avant l'ère du VIN standard
  });

  it('marque inconnue : valide mais sans marque', () => {
    const r = decodeVin(vin('9XX'));
    assert.equal(r.valid, true);
    assert.equal(r.make, null);
  });

  it('refuse un VIN invalide avec un message', () => {
    assert.equal(decodeVin('ABC123').valid, false);
    assert.match(decodeVin('ABC123').message, /17 caractères/);
    assert.match(decodeVin('WVWZZZ1JZXW00000O').message, /I, O et Q/);
    assert.equal(decodeVin('').valid, false);
    assert.equal(decodeVin(undefined).valid, false);
  });
});

describe('décodage VIN enrichi (auto.dev simulé)', () => {
  const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  const volvo = {
    vinValid: true, make: 'Volvo', year: 2008, years: [2008], ambiguous: false,
    vehicle: { make: 'VOLVO', model: 'XC70', year: 2008 },
  };

  it('utilise marque, modèle et année de l\'API', async () => {
    const r = await decodeVinFull('YV1BZ714681002864', { apiKey: 'k', fetchImpl: ok(volvo) });
    assert.equal(r.source, 'auto.dev');
    assert.equal(r.make, 'Volvo');
    assert.equal(r.model, 'XC70');
    assert.equal(r.year, 2008);
  });

  it('année ambiguë : pas d\'année, mais les candidats', async () => {
    const r = await decodeVinFull('VF3ZZZZZZSA000001', {
      apiKey: 'k', fetchImpl: ok({ ...volvo, make: 'PEUGEOT', year: 1995, years: [1995, 2025], ambiguous: true, vehicle: { make: 'PEUGEOT', model: '306' } }),
    });
    assert.equal(r.year, null);
    assert.deepEqual(r.yearCandidates, [1995, 2025]);
    assert.equal(r.make, 'Peugeot');
  });

  it('repli hors ligne si l\'API échoue (HTTP, réseau) ou sans clé', async () => {
    const http401 = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const boom = async () => { throw new Error('réseau'); };
    for (const fetchImpl of [http401, boom]) {
      const r = await decodeVinFull('WBAZZZZZZSA000001', { apiKey: 'k', fetchImpl });
      assert.equal(r.source, 'offline');
      assert.equal(r.make, 'BMW');
      assert.equal(r.model, null);
    }
    const noKey = await decodeVinFull('WBAZZZZZZSA000001', { fetchImpl: boom });
    assert.equal(noKey.source, 'offline');
  });

  it('n\'appelle pas l\'API pour un VIN invalide, et met en cache', async () => {
    let calls = 0;
    const counting = async () => { calls += 1; return ok(volvo)(); };
    await decodeVinFull('court', { apiKey: 'k', fetchImpl: counting });
    assert.equal(calls, 0);
    await decodeVinFull('YV1CZ714691002864', { apiKey: 'k', fetchImpl: counting });
    await decodeVinFull('yv1cz714691002864', { apiKey: 'k', fetchImpl: counting });
    assert.equal(calls, 1);
  });
});

describe('route /api/vin', () => {
  let a;
  before(async () => { await resetDb(); a = await loginAs('alice'); });
  after(closeDb);

  it('exige une connexion et décode', async () => {
    const { anon } = await import('./helpers.js');
    await anon().get('/api/vin/WVWZZZ1JZXW000001').expect(401);
    const r = await a.get('/api/vin/WVWZZZ1JZXW000001').expect(200);
    assert.equal(r.body.make, 'Volkswagen');
  });
});
