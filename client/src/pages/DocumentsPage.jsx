import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import FormModal from '../components/FormModal.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { LABELS, date, options, size, thumb } from '../format.js';
import { useLoad, usePasteFiles } from '../hooks.js';
import { useToast } from '../toast.jsx';

const LINK_LABELS = { vehicle: 'Véhicule', intervention: 'Intervention', transaction: 'Dépense', task: 'Tâche', user: 'Utilisateur' };

export default function DocumentsPage() {
  const toast = useToast();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [pasted, setPasted] = useState([]);
  usePasteFiles(true, (files) => { setPasted(files); setUploading(true); });

  const vehicles = useLoad(() => api.get('/vehicles?status=all'), []);
  const docs = useLoad(
    () => api.get(`/documents${qs({
      category, q: search.trim(),
      general: scope === 'garage' ? 'true' : undefined,
      vehicleId: /^\d+$/.test(scope) ? scope : undefined,
      include: /^\d+$/.test(scope) ? 'children' : undefined,
    })}`),
    [category, search, scope],
  );
  const list = docs.data?.documents ?? [];
  const vehicleById = Object.fromEntries((vehicles.data?.vehicles ?? []).map((v) => [v.id, v]));
  const images = list.filter((d) => d.isImage);

  async function upload(v) {
    const fd = new FormData();
    for (const f of v.files) fd.append('files', f);
    fd.append('category', v.category || 'autre');
    if (v.title) fd.append('title', v.title);
    if (v.vehicleId) fd.append('vehicleId', v.vehicleId);
    await api.post('/documents', fd);
    toast('Document ajouté.');
    docs.reload();
  }

  async function remove(d) {
    if (!window.confirm(`Supprimer « ${d.title || d.originalName} » ?`)) return;
    try { await api.del(`/documents/${d.id}`); docs.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="row between wrap">
          <h1 className="pink-title">Documents</h1>
          <div className="filters">
            <input type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
              <option value="">Toutes catégories</option>
              {options(LABELS.docCategory).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Véhicule">
              <option value="">Tous les documents</option>
              <option value="garage">Garage (non liés)</option>
              {vehicles.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model}</option>)}
            </select>
            <button type="button" className="btn small" onClick={() => setUploading(true)}>+ Document</button>
          </div>
        </div>

        <p className="muted">{list.length} document{list.length > 1 ? 's' : ''}</p>
        <ul className="doc-list">
          {list.map((d) => (
            <li key={d.id} className="doc-item">
              {d.isImage
                ? <button type="button" className="doc-thumb" onClick={() => setViewer(images.indexOf(d))} aria-label="Voir"><img src={thumb(d.thumbUrl, 320)} alt="" loading="lazy" /></button>
                : <a className="doc-thumb file" href={`${d.url}${d.mimeType === 'application/pdf' ? '' : '?download=1'}`} target="_blank" rel="noreferrer">{d.originalName.split('.').pop()?.slice(0, 4)}</a>}
              <div className="doc-info">
                <strong>{d.title || d.originalName}</strong>
                <span className="muted">{LABELS.docCategory[d.category]} · {size(d.sizeBytes)} · {date(d.createdAt)}{d.uploadedByName && ` · ${d.uploadedByName}`}</span>
                <span className="doc-links">
                  {d.links.length === 0 && <span className="badge ghost">Garage</span>}
                  {d.links.map((l) => (l.type === 'vehicle' && vehicleById[l.id]
                    ? <Link key={`${l.type}${l.id}`} className="badge ghost" to={`/voitures/${l.id}`}>{vehicleById[l.id].make} {vehicleById[l.id].model}</Link>
                    : <span key={`${l.type}${l.id}`} className="badge ghost">{LINK_LABELS[l.type]}</span>))}
                </span>
              </div>
              <button type="button" className="link danger" onClick={() => remove(d)}>Supprimer</button>
            </li>
          ))}
        </ul>
        {docs.data && list.length === 0 && <p className="muted">Aucun document.</p>}
      </div>

      {viewer !== null && viewer >= 0 && <Lightbox images={images} start={viewer} onClose={() => setViewer(null)} />}
      {uploading && (
        <FormModal
          title="Ajouter des documents"
          submitLabel="Envoyer"
          initial={{ category: pasted.length && pasted.every((f) => f.type.startsWith('image/')) ? 'photo' : 'autre', files: pasted }}
          fields={[
            { name: 'files', label: 'Fichiers', type: 'file', multiple: true, required: true, hint: '30 Mo maximum par fichier.' },
            { name: 'category', label: 'Catégorie', type: 'select', required: true, options: options(LABELS.docCategory) },
            { name: 'vehicleId', label: 'Véhicule', type: 'select', hint: 'Aucun = document général du garage.', options: (vehicles.data?.vehicles ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model}` })) },
            { name: 'title', label: 'Titre', hint: 'Facultatif (si un seul fichier).' },
          ]}
          onSubmit={upload}
          onClose={() => { setUploading(false); setPasted([]); }}
        />
      )}
    </div>
  );
}
