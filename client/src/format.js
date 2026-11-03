const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const money = (n) => eur.format(n ?? 0);

export const date = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

export const plate = (p) => (p && /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p) ? `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}` : p ?? '');

export const vehicleName = (v) => `${v.make} ${v.model}`;

export const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`);

export const LABELS = {
  vehicleStatus: { sur_place: 'Sur place', en_vue: 'En vue', terminee: 'Terminées', en_vente: 'En vente' },
  kind: { entretien: 'Entretien', reparation: 'Réparation' },
  interventionStatus: { planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé' },
  direction: { depense: 'Dépense', revenu: 'Revenu' },
  txCategory: {
    piece: 'Pièce', reparation: 'Réparation', entretien: 'Entretien', achat_vehicule: 'Achat de véhicule',
    vente_vehicule: 'Vente de véhicule', frais_garage: 'Frais du garage', autre: 'Autre',
  },
  taskStatus: { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' },
  priority: { basse: 'Basse', normale: 'Normale', haute: 'Haute' },
  docCategory: { facture: 'Facture', carte_grise: 'Carte grise', photo: 'Photo', administratif: 'Administratif', autre: 'Autre' },
};

export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// Dates "locales" au format AAAA-MM-JJ (toISOString() convertirait en UTC et décalerait d'un jour en France)
const pad = (n) => String(n).padStart(2, '0');
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => localIso(new Date());

/** Vignette WebP d'une image (largeurs : 320, 640, 1280, 1920) à partir de l'URL de base renvoyée par l'API. */
export const thumb = (url, w = 640) => (url ? `${url}?w=${w}` : null);
