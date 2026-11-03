import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { THEMES, applyTheme, cacheTheme, getTheme } from '../theme.js';
import { useToast } from '../toast.jsx';

/** Bouton « palette » de la barre de navigation : ouvre la liste des thèmes avec aperçu. */
export default function ThemePicker() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const theme = user?.theme ?? getTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Applique tout de suite (sans attendre le serveur), puis enregistre sur le compte
  async function choose(id) {
    setOpen(false);
    applyTheme(id);
    cacheTheme(id);
    try {
      const r = await api.patch('/users/me', { theme: id });
      setUser(r.user);
    } catch (err) {
      toast(`Thème appliqué ici, mais non enregistré sur ton compte : ${err.message}`, 'error');
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button type="button" className="btn ghost small" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" title="Changer de thème">
        🎨<span className="theme-label"> Thème</span>
      </button>
      {open && (
        <div className="theme-menu panel" role="menu" aria-label="Thèmes">
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="menuitemradio" aria-checked={theme === t.id}
                className={`theme-card${theme === t.id ? ' active' : ''}`} onClick={() => choose(t.id)}>
                <img src={`/backgrounds/${t.id}-thumb.jpg`} alt="" loading="lazy" />
                <span className="theme-name">{t.name}</span>
                <span className="muted theme-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
