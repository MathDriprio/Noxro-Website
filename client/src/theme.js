export const THEMES = [
  { id: 'neon', name: 'Néon', desc: 'Violet et rose, garage cyberpunk', color: '#4b1450' },
  { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Rue sous le brouillard, cyan et magenta', color: '#0d2b3a' },
  { id: 'atelier', name: 'Atelier', desc: 'Vieux garage, lumière ambrée', color: '#3a2511' },
  { id: 'circuit', name: 'Circuit', desc: 'Piste et rouge course', color: '#3a0f15' },
  { id: 'raid', name: 'Raid', desc: 'Dunes du Sahara, terre et orange', color: '#54351d' },
  { id: 'furtif', name: 'Furtif', desc: 'Sombre et sobre, argent', color: '#1c232b' },
];

const KEY = 'noxro-theme';
const DEFAULT = THEMES[0].id;

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? t : DEFAULT;
  } catch { return DEFAULT; }
}

export function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES.find((t) => t.id === id)?.color ?? '#2a0a30');
}

/** Garde le thème en cache dans ce navigateur (affichage immédiat, y compris avant la connexion). */
export function cacheTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* stockage indisponible : sans conséquence */ }
}
