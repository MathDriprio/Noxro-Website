import { useState } from 'react';
import { api, qs } from '../api.js';
import { LABELS, date, options, size, thumb } from '../format.js';
import { useLoad, usePasteFiles } from '../hooks.js';
import { useToast } from '../toast.jsx';
import FormModal from './FormModal.jsx';
import Lightbox from './Lightbox.jsx';

/**
 * Documents d'un élément. `target` = { vehicleId } | { interventionId } | ...
 * `photos` : affiche la galerie (catégorie photo) avec carrousel plein écran.
 */
export default function Documents({ target, includeChildren = false, photos = false, defaultCategory = 'autre', coverId, onCover, onChange }) {
  const toast = useToast();
  const { data, reload } = useLoad(
    () => api.get(`/documents${qs({ ...target, include: includeChildren ? 'children' : undefined })}`),
    [JSON.stringify(target), includeChildren],
  );
  const [uploading, setUploading] = useState(false);
  const [pasted, setPasted] = useState([]);
  const [viewer, setViewer] = useState(null);

  // Ctrl+V sur l'onglet photos : ouvre l'envoi avec l'image déjà prête
  usePasteFiles(photos, (files) => { setPasted(files); setUploading(true); });

  const docs = data?.documents ?? [];
  const images = photos ? docs.filter((d) => d.category === 'photo' && d.isImage) : [];
  const files = docs.filter((d) => !images.includes(d));

  async function upload(v) {
    const fd = new FormData();
    for (const f of v.files) fd.append('files', f);
    fd.append('category', v.category || 'autre');
    if (v.title) fd.append('title', v.title);
    for (const [k, val] of Object.entries(target)) fd.append(k, val);
    await api.post('/documents', fd);
    toast('Document ajouté.');
    await reload();
    onChange?.();
  }

  async function remove(d) {
    if (!window.confirm(`Supprimer « ${d.title || d.originalName} » ?`)) return;
    try { await api.del(`/documents/${d.id}`); await reload(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="documents">
      <div className="row between">
        <span className="muted">{docs.length} document{docs.length > 1 ? 's' : ''}</span>
        <button type="button" className="btn small" onClick={() => setUploading(true)}>{photos ? '+ Photos / documents' : '+ Document'}</button>
      </div>

      {images.length > 0 && (
        <div className="photo-grid">
          {images.map((d, i) => (
            <figure key={d.id} className="photo">
              <button type="button" onClick={() => setViewer(i)} aria-label={`Voir ${d.title || d.originalName}`}>
                <img src={thumb(d.thumbUrl, 640)} alt={d.title || d.originalName} loading="lazy" />
              </button>
              {onCover && (
                <span className="photo-actions">
                  <button type="button" className="link" disabled={coverId === d.id} onClick={() => onCover(d.id)}>{coverId === d.id ? '★ Principale' : '☆ Principale'}</button>
                  <button type="button" className="link danger" onClick={() => remove(d)}>Supprimer</button>
                </span>
              )}
            </figure>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((d) => (
            <li key={d.id}>
              <a href={`${d.url}${d.isImage || d.mimeType === 'application/pdf' ? '' : '?download=1'}`} target="_blank" rel="noreferrer">{d.title || d.originalName}</a>
              <span className="muted">{LABELS.docCategory[d.category]} · {size(d.sizeBytes)} · {date(d.createdAt)}</span>
              <button type="button" className="link danger" onClick={() => remove(d)}>Supprimer</button>
            </li>
          ))}
        </ul>
      )}
      {docs.length === 0 && <p className="muted">Aucun document.</p>}

      {viewer !== null && <Lightbox images={images} start={viewer} onClose={() => setViewer(null)} />}
      {uploading && (
        <FormModal
          title="Ajouter des documents"
          submitLabel="Envoyer"
          initial={{ category: pasted.length && pasted.every((f) => f.type.startsWith('image/')) ? 'photo' : defaultCategory, files: pasted }}
          fields={[
            { name: 'files', label: 'Fichiers', type: 'file', multiple: true, required: true, hint: '30 Mo maximum par fichier.' },
            { name: 'category', label: 'Catégorie', type: 'select', required: true, options: options(LABELS.docCategory) },
            { name: 'title', label: 'Titre', hint: 'Facultatif (si un seul fichier).' },
          ]}
          onSubmit={upload}
          onClose={() => { setUploading(false); setPasted([]); }}
        />
      )}
    </div>
  );
}
