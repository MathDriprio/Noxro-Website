// Décodage d'un VIN (ISO 3779).
// - Hors ligne : constructeur via le WMI (3 premiers caractères). L'année "modèle" (10e caractère)
//   n'est fiable qu'en Amérique du Nord : on ne la renvoie qu'à titre indicatif.
// - Enrichi (si une clé auto.dev est configurée) : marque, modèle et année via l'API ; repli hors ligne en cas d'échec.

const WMI = {
  // France
  VF1: 'Renault', VF3: 'Peugeot', VR3: 'Peugeot', VF7: 'Citroën', VR7: 'Citroën', VR1: 'DS', VF9: 'Bugatti',
  // Allemagne
  WVW: 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen', WV3: 'Volkswagen', WAU: 'Audi', WUA: 'Audi',
  WBA: 'BMW', WBS: 'BMW', WBY: 'BMW', WMW: 'MINI', WP0: 'Porsche', WP1: 'Porsche',
  WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDF: 'Mercedes-Benz',
  W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz', W1V: 'Mercedes-Benz', WME: 'smart',
  W0L: 'Opel', W0V: 'Opel', WF0: 'Ford',
  // Italie
  ZFA: 'Fiat', ZFF: 'Ferrari', ZAR: 'Alfa Romeo', ZLA: 'Lancia', ZAM: 'Maserati', ZHW: 'Lamborghini',
  // Royaume-Uni
  SAJ: 'Jaguar', SAL: 'Land Rover', SCC: 'Lotus', SCB: 'Bentley', SCF: 'Aston Martin', SCA: 'Rolls-Royce',
  // Suède, Espagne, Europe de l'Est
  YV1: 'Volvo', YV4: 'Volvo', YS3: 'Saab', VSS: 'SEAT', TMB: 'Škoda', UU1: 'Dacia', XTA: 'Lada',
  // Asie
  JHM: 'Honda', JN1: 'Nissan', JN8: 'Nissan', JM1: 'Mazda', JM3: 'Mazda', JMZ: 'Mazda',
  JA3: 'Mitsubishi', JA4: 'Mitsubishi', JF1: 'Subaru', JF2: 'Subaru', JTH: 'Lexus', JTJ: 'Lexus',
  KMH: 'Hyundai', KMF: 'Hyundai', KNA: 'Kia', KND: 'Kia',
  // Amérique
  '1FA': 'Ford', '1FT': 'Ford', '1G1': 'Chevrolet', '1GC': 'Chevrolet', '1HG': 'Honda',
  '1C3': 'Chrysler', '1C4': 'Chrysler', '1J4': 'Jeep', '5YJ': 'Tesla', '5UX': 'BMW',
};
// Préfixes de 2 caractères quand le WMI exact n'est pas dans la table
const WMI2 = { JT: 'Toyota', JS: 'Suzuki' };

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // cycle de 30 ans, A = 1980 ou 2010

export const normalizeVin = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');

export function decodeVin(raw) {
  const vin = normalizeVin(raw);
  if (!VIN_RE.test(vin)) {
    return {
      vin, valid: false, make: null, yearCandidates: [],
      message: vin.length === 17
        ? 'Les lettres I, O et Q ne sont pas autorisées dans un VIN.'
        : 'Un VIN standard fait 17 caractères (les véhicules d\'avant 1981 n\'en ont pas).',
    };
  }
  const make = WMI[vin.slice(0, 3)] ?? WMI2[vin.slice(0, 2)] ?? null;

  const i = YEAR_CODES.indexOf(vin[9]);
  const maxYear = new Date().getFullYear() + 1;
  const yearCandidates = i < 0 ? [] : [1980 + i, 2010 + i].filter((y) => y >= 1981 && y <= maxYear);

  return { vin, valid: true, make, yearCandidates, message: null };
}

// --- enrichissement via auto.dev (palier gratuit : 1000 appels/mois -> on met les réponses en cache) ---

const cache = new Map();
const CACHE_MAX = 500;
const properCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null);

async function fetchAutoDev(vin, { apiKey, fetchImpl }) {
  if (cache.has(vin)) return cache.get(vin);
  const res = await fetchImpl(`https://api.auto.dev/vin/${vin}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`auto.dev HTTP ${res.status}`);
  const d = await res.json();
  if (d.vinValid === false) return null;
  const years = Array.isArray(d.years) ? d.years : [];
  const result = {
    make: d.make ? properCase(d.make) : properCase(d.vehicle?.make),
    model: d.vehicle?.model ?? null,
    year: d.year && !d.ambiguous && !d.yearAmbiguous ? d.year : null,
    yearCandidates: years,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(vin, result);
  return result;
}

/** Décode un VIN ; complète avec auto.dev si possible, sinon renvoie le décodage hors ligne. */
export async function decodeVinFull(raw, { apiKey = null, fetchImpl = fetch } = {}) {
  const base = { ...decodeVin(raw), model: null, year: null, source: 'offline' };
  if (!base.valid || !apiKey) return base;
  try {
    const extra = await fetchAutoDev(base.vin, { apiKey, fetchImpl });
    if (!extra) return base;
    return {
      ...base,
      make: extra.make ?? base.make,
      model: extra.model,
      year: extra.year,
      yearCandidates: extra.yearCandidates.length ? extra.yearCandidates : base.yearCandidates,
      source: 'auto.dev',
    };
  } catch (err) {
    console.error('vin: auto.dev indisponible, repli hors ligne :', err.message);
    return base;
  }
}
