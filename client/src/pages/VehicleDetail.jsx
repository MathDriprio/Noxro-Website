import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Comments from '../components/Comments.jsx';
import Documents from '../components/Documents.jsx';
import History from '../components/History.jsx';
import FormModal from '../components/FormModal.jsx';
import { LABELS, date, money, plate, thumb, vehicleName } from '../format.js';
import { useArrowTabs, useLoad } from '../hooks.js';
import { useToast } from '../toast.jsx';
import { Interventions, Tasks, Transactions } from './vehicleTabs.jsx';
import { vehicleFields, vehiclePayload } from './vehicleForm.js';

const TABS = [
  ['apercu', 'Aperçu'], ['historique', 'Historique'], ['interventions', 'Entretiens & réparations'], ['depenses', 'Dépenses'],
  ['documents', 'Photos & documents'], ['taches', 'Tâches'], ['commentaires', 'Commentaires'],
];

export default function VehicleDetail() {
  const { id } = useParams();
  const vid = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('apercu');
  const [editing, setEditing] = useState(false);

  const detail = useLoad(() => api.get(`/vehicles/${vid}`), [vid]);
  const users = useLoad(() => api.get('/users'), []);
  useArrowTabs(TABS.map(([key]) => key), tab, setTab); // ← / → changent de catégorie
  const v = detail.data?.vehicle;
  const stats = detail.data?.stats;

  if (detail.error?.status === 404) return <div className="panel"><div className="panel-body"><p>Véhicule introuvable.</p><Link to="/voitures">← Retour</Link></div></div>;
  if (!v) return <p className="muted">Chargement…</p>;

  const deleted = Boolean(v.deletedAt);
  const userList = users.data?.users ?? [];

  async function remove() {
    if (!window.confirm(`Supprimer « ${vehicleName(v)} » ? Il pourra être restauré depuis la page « Supprimées ».`)) return;
    try { await api.del(`/vehicles/${vid}`); toast('Véhicule supprimé.'); navigate('/voitures'); } catch (e) { toast(e.message, 'error'); }
  }
  async function restore() {
    try { await api.post(`/vehicles/${vid}/restore`); toast('Véhicule restauré.'); detail.reload(); } catch (e) { toast(e.message, 'error'); }
  }
  async function setCover(documentId) {
    try { await api.patch(`/vehicles/${vid}`, { coverDocumentId: documentId }); detail.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="vehicle-page">
      <Link to="/voitures" className="back">← Les voitures</Link>

      <div className="panel vehicle-head">
        <div className="panel-body">
          <div className="vehicle-cover">{v.coverThumbUrl ? <img src={thumb(v.coverThumbUrl, 640)} alt="" /> : <span className="no-photo">Pas de photo</span>}</div>
          <div className="vehicle-main">
            <h1 className="pink-title">{vehicleName(v)}</h1>
            <p className="muted">
              {[v.year, plate(v.plate), v.engine, v.color].filter(Boolean).join(' · ') || 'Aucun détail renseigné'}
            </p>
            <p>
              <span className="badge">{LABELS.vehicleStatus[v.status]}</span>{' '}
              {deleted && <span className="badge danger">Supprimé</span>}{' '}
              {v.isGarage ? <span className="badge ghost">Garage</span> : v.owners.map((o) => <span key={o.userId} className="badge ghost">{o.displayName}</span>)}
            </p>
            <div className="row wrap">
              {deleted ? <button type="button" className="btn" onClick={restore}>Restaurer</button> : (
                <>
                  <button type="button" className="btn" onClick={() => setEditing(true)}>Modifier</button>
                  <button type="button" className="btn ghost danger" onClick={remove}>Supprimer</button>
                </>
              )}
            </div>
          </div>
          <dl className="kpis">
            <div><dt>Dépenses</dt><dd>{money(stats.expenses)}</dd></div>
            {stats.revenue > 0 && <div><dt>Revenus</dt><dd>{money(stats.revenue)}</dd></div>}
            <div><dt>Interventions</dt><dd>{stats.interventions}</dd></div>
            <div><dt>Tâches ouvertes</dt><dd>{stats.openTasks}</dd></div>
          </dl>
        </div>
      </div>

      {deleted && <p className="banner">Ce véhicule est supprimé : restaure-le pour modifier son contenu.</p>}

      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
        <span className="tabs-hint muted" title="Les flèches ← → du clavier changent de catégorie" aria-hidden="true">← →</span>
      </div>

      <div className="panel">
        <div className="panel-body">
          {tab === 'apercu' && <Overview v={v} history={detail.data.ownerHistory} users={userList} onSaved={detail.reload} readOnly={deleted} />}
          {tab === 'historique' && <History vehicleId={vid} onOpenTab={setTab} />}
          {tab === 'interventions' && <Interventions vehicleId={vid} readOnly={deleted} onChange={detail.reload} />}
          {tab === 'depenses' && <Transactions vehicleId={vid} readOnly={deleted} onChange={detail.reload} />}
          {tab === 'documents' && (
            <Documents target={{ vehicleId: vid }} photos defaultCategory="photo" coverId={v.coverDocumentId} onCover={deleted ? undefined : setCover} onChange={detail.reload} />
          )}
          {tab === 'taches' && <Tasks vehicleId={vid} users={userList} readOnly={deleted} onChange={detail.reload} />}
          {tab === 'commentaires' && <Comments target={{ vehicleId: vid }} />}
        </div>
      </div>

      {editing && (
        <FormModal
          title="Modifier le véhicule"
          fields={vehicleFields(userList).filter((f) => f.name !== 'ownerIds')}
          initial={Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? '']))}
          onSubmit={async (vals) => {
            const { ownerIds, ...payload } = vehiclePayload(vals);
            await api.patch(`/vehicles/${vid}`, payload);
            toast('Véhicule modifié.');
            detail.reload();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Overview({ v, history, users, onSaved, readOnly }) {
  const toast = useToast();
  const [editOwners, setEditOwners] = useState(false);
  return (
    <div className="overview">
      <dl className="info">
        <div><dt>Marque</dt><dd>{v.make}</dd></div>
        <div><dt>Modèle</dt><dd>{v.model}</dd></div>
        <div><dt>Année</dt><dd>{v.year ?? '—'}</dd></div>
        <div><dt>Immatriculation</dt><dd>{plate(v.plate) || '—'}</dd></div>
        <div><dt>N° de série</dt><dd>{v.vin ?? '—'}</dd></div>
        <div><dt>Motorisation</dt><dd>{v.engine ?? '—'}</dd></div>
        <div><dt>Couleur</dt><dd>{v.color ?? '—'}</dd></div>
      </dl>
      {v.notes && <p className="notes">{v.notes}</p>}

      <div className="row between">
        <h3>Propriétaires</h3>
        {!readOnly && <button type="button" className="btn small" onClick={() => setEditOwners(true)}>Changer</button>}
      </div>
      <ul className="owner-history">
        {history.length === 0 && <li className="muted">Véhicule du garage depuis toujours.</li>}
        {history.map((o, i) => (
          <li key={i} className={o.until ? 'muted' : ''}>
            <strong>{o.displayName}</strong> — depuis le {date(o.since)}{o.until ? ` jusqu'au ${date(o.until)}` : ' (actuel)'}
          </li>
        ))}
        {v.isGarage && history.length > 0 && <li>Actuellement : <strong>garage</strong></li>}
      </ul>

      {editOwners && (
        <FormModal
          title="Propriétaires"
          fields={[{ name: 'ownerIds', label: 'Propriétaires actuels', type: 'checks', options: users.map((u) => ({ value: u.id, label: u.displayName })), hint: 'Aucun = véhicule du garage. L\'historique est conservé.' }]}
          initial={{ ownerIds: v.owners.map((o) => o.userId) }}
          onSubmit={async (vals) => { await api.put(`/vehicles/${v.id}/owners`, { userIds: vals.ownerIds }); toast('Propriétaires mis à jour.'); onSaved(); }}
          onClose={() => setEditOwners(false)}
        />
      )}
    </div>
  );
}
