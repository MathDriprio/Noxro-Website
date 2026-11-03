import { api } from '../api.js';
import { LABELS, options } from '../format.js';

/** Décode le VIN saisi : préremplit marque, modèle et année (champs vides uniquement) et explique le résultat. */
async function decodeVin(values) {
  if (!String(values.vin ?? '').trim()) throw new Error('Saisis d\'abord le numéro de série.');
  const r = await api.get(`/vin/${encodeURIComponent(values.vin)}`);
  if (!r.valid) throw new Error(r.message);

  const parts = [];
  const found = [r.make, r.model].filter(Boolean).join(' ');
  const typed = String(values.make ?? '').trim();
  if (r.make && typed && typed.toLowerCase() !== r.make.toLowerCase()) {
    parts.push(`Le VIN indique plutôt : ${found}.`);
  } else if (found) {
    parts.push(`Trouvé : ${found}${r.year ? `, ${r.year} (année à vérifier)` : ''}.`);
  } else {
    parts.push('Constructeur non reconnu.');
  }
  if (!r.year && r.yearCandidates.length) {
    parts.push(`Année possible : ${r.yearCandidates.join(' ou ')} (indicatif).`);
  }
  if (r.source === 'offline' && !r.model) parts.push('Modèle indisponible : à saisir à la main.');

  return {
    set: { vin: r.vin },
    fill: { make: r.make ?? '', model: r.model ?? '', year: r.year ?? '' },
    message: parts.join(' '),
  };
}

export const vehicleFields = (users) => [
  { name: 'make', label: 'Marque', required: true },
  { name: 'model', label: 'Modèle', required: true },
  { name: 'year', label: 'Année', type: 'number', placeholder: '1974' },
  { name: 'plate', label: 'Immatriculation', placeholder: 'AB-123-CD', hint: 'Si elle correspond à un véhicule supprimé, celui-ci sera réactivé.' },
  { name: 'vin', label: 'N° de série (VIN)', placeholder: '17 caractères', action: { label: 'Décoder le VIN', run: decodeVin } },
  { name: 'engine', label: 'Motorisation' },
  { name: 'color', label: 'Couleur' },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options(LABELS.vehicleStatus) },
  { name: 'ownerIds', label: 'Propriétaires', type: 'checks', options: users.map((u) => ({ value: u.id, label: u.displayName })), hint: 'Aucun = véhicule du garage.' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** Formulaire -> payload API (chaînes vides -> null, année -> nombre). */
export function vehiclePayload(v) {
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = val === '' ? null : val;
  if (out.year != null) out.year = Number(out.year);
  return out;
}
