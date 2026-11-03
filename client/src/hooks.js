import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from './toast.jsx';

/** Charge des données ; `reload()` les rafraîchit. Les erreurs sont affichées en toast. */
export function useLoad(loader, deps) {
  const toast = useToast();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return loader().then(
      (data) => setState({ data, loading: false, error: null }),
      (error) => { setState({ data: null, loading: false, error }); toast(error.message, 'error'); },
    );
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Les captures collées s'appellent toutes « image.png » : on leur donne un nom unique et lisible. */
export function nameClipboardFile(file, i = 0) {
  if (!/^image\.\w+$/i.test(file.name)) return file;
  const ext = file.name.split('.').pop().toLowerCase();
  return new File([file], `capture-${stamp()}${i ? `-${i + 1}` : ''}.${ext}`, { type: file.type });
}

/** Fichiers présents dans l'événement « coller » (captures d'écran, images copiées, fichiers copiés). */
export function filesFromPaste(event) {
  return [...(event.clipboardData?.files ?? [])].map(nameClipboardFile);
}

/** Appelle onFiles(fichiers) quand l'utilisateur colle des fichiers/images sur la page (Ctrl+V). */
export function usePasteFiles(enabled, onFiles) {
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e) => {
      if (document.querySelector('.modal-backdrop, .lightbox')) return; // une fenêtre est ouverte : elle gère elle-même
      const files = filesFromPaste(e);
      if (files.length) { e.preventDefault(); ref.current(files); }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [enabled]);
}

/**
 * ← / → passent à l'onglet précédent / suivant (en boucle). Sans effet pendant la saisie (champ, liste déroulante),
 * quand une fenêtre ou la visionneuse photo est ouverte (elle utilise déjà les flèches), ni avec une touche de modification.
 */
export function useArrowTabs(ids, current, onChange) {
  const ref = useRef({ ids, current, onChange });
  ref.current = { ids, current, onChange };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.modal-backdrop, .lightbox')) return;
      const { ids: list, current: cur, onChange: change } = ref.current;
      const step = e.key === 'ArrowRight' ? 1 : -1;
      e.preventDefault();
      change(list[(list.indexOf(cur) + step + list.length) % list.length]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
