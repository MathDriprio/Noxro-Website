import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { LABELS, localIso, today } from '../format.js';
import { useLoad } from '../hooks.js';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MAX_CHIPS = 3;

/** 6 semaines (lundi premier) couvrant le mois affiché. */
function gridDays(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

const eventLink = (e) => (e.vehicleId ? `/voitures/${e.vehicleId}` : '/taches');

/** Calendrier mensuel des interventions planifiées et des tâches à échéance. */
export default function Calendar() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState(today());
  const todayIso = today();

  const days = useMemo(() => gridDays(cursor.year, cursor.month), [cursor]);
  const from = localIso(days[0]);
  const to = localIso(days[41]);
  const { data } = useLoad(() => api.get(`/calendar${qs({ from, to })}`), [from, to]);

  const byDay = useMemo(() => {
    const map = {};
    for (const e of data?.events ?? []) (map[e.date] ??= []).push(e);
    return map;
  }, [data]);

  const move = (d) => setCursor(({ year, month }) => {
    const n = new Date(year, month + d, 1);
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const goToday = () => { setCursor({ year: now.getFullYear(), month: now.getMonth() }); setSelected(todayIso); };

  const selectedEvents = byDay[selected] ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="calendar panel">
      <div className="panel-body">
        <div className="cal-head">
          <button type="button" className="car-nav" onClick={() => move(-1)} aria-label="Mois précédent">‹</button>
          <h2 className="pink-title cal-title">{MONTHS[cursor.month]} {cursor.year}</h2>
          <button type="button" className="car-nav" onClick={() => move(1)} aria-label="Mois suivant">›</button>
          <button type="button" className="btn ghost small" onClick={goToday}>Aujourd'hui</button>
        </div>

        <div className="cal-grid" role="grid" aria-label={`${MONTHS[cursor.month]} ${cursor.year}`}>
          {DAYS.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
          {days.map((d) => {
            const iso = localIso(d);
            const events = byDay[iso] ?? [];
            const classes = ['cal-day'];
            if (d.getMonth() !== cursor.month) classes.push('other');
            if (iso === todayIso) classes.push('today');
            if (iso === selected) classes.push('selected');
            return (
              <button key={iso} type="button" role="gridcell" className={classes.join(' ')} onClick={() => setSelected(iso)}
                aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}, ${events.length} événement${events.length > 1 ? 's' : ''}`}>
                <span className="cal-num">{d.getDate()}</span>
                <span className="cal-chips">
                  {events.slice(0, MAX_CHIPS).map((e) => (
                    <span key={`${e.type}${e.id}`} className={`cal-chip ${e.type}${iso < todayIso ? ' late' : ''}`}>{e.title}</span>
                  ))}
                  {events.length > MAX_CHIPS && <span className="cal-more">+{events.length - MAX_CHIPS}</span>}
                </span>
                {events.length > 0 && (
                  <span className="cal-dots" aria-hidden="true">
                    {events.slice(0, 4).map((e) => <i key={`${e.type}${e.id}`} className={`${e.type}${iso < todayIso ? ' late' : ''}`} />)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="cal-legend muted">
          <span><i className="intervention" /> Intervention</span>
          <span><i className="task" /> Tâche</span>
          <span><i className="late" /> En retard</span>
        </div>

        <h3 className="cal-selected">{selectedLabel}{selected < todayIso && ' (passé)'}</h3>
        {selectedEvents.length === 0 && <p className="muted">Rien de prévu ce jour-là.</p>}
        <ul className="cal-events">
          {selectedEvents.map((e) => (
            <li key={`${e.type}${e.id}`}>
              <Link to={eventLink(e)} className={`cal-event ${e.type}${selected < todayIso ? ' late' : ''}`}>
                <span className="badge">{e.type === 'intervention' ? LABELS.kind[e.kind] : 'Tâche'}</span>
                <strong>{e.title}</strong>
                <span className="muted">
                  {e.vehicleName ?? 'Garage'}
                  {e.type === 'task' && e.assigneeName && ` · ${e.assigneeName}`}
                  {e.type === 'task' && e.priority === 'haute' && ' · 🔥 haute'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
