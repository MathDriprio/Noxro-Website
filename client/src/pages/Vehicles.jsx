import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import FormModal from '../components/FormModal.jsx';
import { LABELS, plate, thumb, vehicleName } from '../format.js';
import { useLoad } from '../hooks.js';
import { useToast } from '../toast.jsx';
import { vehicleFields, vehiclePayload } from './vehicleForm.js';

const FILTERS = [['sur_place', 'Sur place'], ['en_vue', 'En vue'], ['terminee', 'Terminées'], ['en_vente', 'En vente'], ['all', 'Toutes'], ['deleted', 'Supprimées']];

export default function Vehicles() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = params.get('statut') ?? 'sur_place';
  const owner = params.get('proprietaire') ?? '';
  const search = params.get('q') ?? '';
  const [creating, setCreating] = useState(false);

  const counts = useLoad(() => api.get('/vehicles/counts'), []);
  const users = useLoad(() => api.get('/users'), []);
  const list = useLoad(
    () => api.get(`/vehicles${qs({ status: filter === 'deleted' ? 'all' : filter, deleted: filter === 'deleted' ? 'true' : undefined, owner, q: search })}`),
    [filter, owner, search],
  );

  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const countOf = (key) => (key === 'deleted' ? counts.data?.deleted : counts.data?.[key]);
  const userOptions = useMemo(() => users.data?.users ?? [], [users.data]);

  async function create(v) {
    const r = await api.post('/vehicles', vehiclePayload(v));
    toast(r.reactivated ? `« ${vehicleName(r.vehicle)} » existait déjà (supprimé) : il a été réactivé.` : 'Véhicule ajouté.');
    counts.reload();
    list.reload();
  }

  return (
    <div className="vehicles-page">
      <aside className="side-filters" aria-label="Filtres">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" className={`side-filter${filter === key ? ' active' : ''}`} onClick={() => setParam('statut', key === 'sur_place' ? '' : key)}>
            {label} <span className="count">[{countOf(key) ?? '…'}]</span>
          </button>
        ))}
        <div className="side-extra">
          <input type="search" placeholder="Rechercher…" value={search} onChange={(e) => setParam('q', e.target.value)} aria-label="Rechercher" />
          <select value={owner} onChange={(e) => setParam('proprietaire', e.target.value)} aria-label="Propriétaire">
            <option value="">Tous les propriétaires</option>
            <option value="me">Mes véhicules</option>
            <option value="garage">Du garage</option>
            {userOptions.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
      </aside>

      <section className="car-grid">
        {list.data?.vehicles.map((v) => (
          <Link key={v.id} to={`/voitures/${v.id}`} className={`car-card${v.deletedAt ? ' deleted' : ''}`}>
            <span className="car-img">
              {v.coverThumbUrl ? <img src={thumb(v.coverThumbUrl, 640)} alt="" loading="lazy" /> : <span className="no-photo">Pas de photo</span>}
              {filter === 'all' && <span className="badge">{LABELS.vehicleStatus[v.status]}</span>}
            </span>
            <span className="car-name">{vehicleName(v)}</span>
            {v.plate && <span className="muted">{plate(v.plate)}</span>}
          </Link>
        ))}
        {filter !== 'deleted' && (
          <button type="button" className="car-card add-card" onClick={() => setCreating(true)}>
            <span className="car-img add"><span className="plus">+</span></span>
            <span className="car-name">Ajouter</span>
          </button>
        )}
        {list.data?.vehicles.length === 0 && filter === 'deleted' && <p className="muted">Aucun véhicule supprimé.</p>}
      </section>

      {creating && (
        <FormModal
          title="Nouveau véhicule"
          fields={vehicleFields(userOptions)}
          initial={{ status: filter === 'all' || filter === 'deleted' ? 'sur_place' : filter }}
          submitLabel="Ajouter"
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
