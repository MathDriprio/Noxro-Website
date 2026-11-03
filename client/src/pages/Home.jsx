import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Calendar from '../components/Calendar.jsx';
import { date, money } from '../format.js';
import { useLoad } from '../hooks.js';

export default function Home() {
  const { data } = useLoad(() => api.get('/dashboard'), []);
  return (
    <div className="home">
      <h1 className="hero-title">Noxro Garage</h1>
      <div className="home-grid">
        <section>
          <h2 className="pink-title">À venir</h2>
          <Calendar />
        </section>
        <aside className="panel">
          <div className="panel-body">
            <h2 className="pink-title">Bientôt</h2>
            <ul className="soon-list">
              {data?.upcoming.slice(0, 8).map((e) => (
                <li key={`${e.type}${e.id}`} className={e.overdue ? 'overdue' : ''}>
                  <Link to={e.vehicleId ? `/voitures/${e.vehicleId}` : '/'}>{e.title}{e.vehicleName && ` — ${e.vehicleName}`}</Link>
                  <span className="muted"> {date(e.date)}{e.overdue && ' (en retard)'}</span>
                </li>
              ))}
              {data?.upcoming.length === 0 && <li className="muted">Rien de prévu.</li>}
            </ul>
            {data && (
              <p className="muted small-text">
                {data.stats.vehicles} véhicule{data.stats.vehicles > 1 ? 's' : ''} · {data.stats.openTasks} tâche{data.stats.openTasks > 1 ? 's' : ''} ouverte{data.stats.openTasks > 1 ? 's' : ''} · {money(data.stats.spentThisMonth)} dépensés ce mois-ci
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
