import { useState } from 'react';
import { api } from '../api.js';
import { LABELS, options } from '../format.js';
import { useLoad } from '../hooks.js';
import { Tasks } from './vehicleTabs.jsx';

export default function TasksPage() {
  const [status, setStatus] = useState('open');
  const [assignee, setAssignee] = useState('');
  const [scope, setScope] = useState('');
  const users = useLoad(() => api.get('/users'), []);
  const vehicles = useLoad(() => api.get('/vehicles?status=all'), []);

  const query = {
    status: status === 'all' ? undefined : status,
    assigneeId: assignee || undefined,
    general: scope === 'garage' ? 'true' : undefined,
    vehicleId: /^\d+$/.test(scope) ? scope : undefined,
  };

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="row between wrap">
          <h1 className="pink-title">Tâches</h1>
          <div className="filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
              <option value="open">Ouvertes</option>
              {options(LABELS.taskStatus).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="all">Toutes</option>
            </select>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Responsable">
              <option value="">Tous les responsables</option>
              <option value="me">Mes tâches</option>
              {users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Véhicule">
              <option value="">Tous les véhicules</option>
              <option value="garage">Garage (général)</option>
              {vehicles.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model}</option>)}
            </select>
          </div>
        </div>
        {users.data && vehicles.data && (
          <Tasks users={users.data.users} vehicles={vehicles.data.vehicles} query={query} />
        )}
      </div>
    </div>
  );
}
