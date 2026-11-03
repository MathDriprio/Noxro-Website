import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { LABELS, date, money, thumb, today } from '../format.js';
import { useLoad } from '../hooks.js';
import Lightbox from './Lightbox.jsx';

const FILTERS = [
  { id: 'intervention', label: 'Interventions' },
  { id: 'transaction', label: 'Dépenses' },
  { id: 'task', label: 'Tâches' },
  { id: 'document', label: 'Documents' },
  { id: 'comment', label: 'Commentaires' },
  { id: 'owner', label: 'Propriétaires' },
];
const ICONS = { vehicle: '🚗', owner: '🔑', intervention: '🔧', transaction: '💶', task: '☑️', document: '📄', photo: '📷', comment: '💬' };
const ON_LABEL = { intervention: "l'intervention", transaction: 'la dépense', task: 'la tâche', document: 'le document' };
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const monthTitle = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Regroupe les photos ajoutées le même jour par la même personne en un seul événement. */
function groupPhotos(events) {
  const out = [];
  for (const e of events) {
    const isPhoto = e.type === 'document' && e.isImage && e.category === 'photo';
    const prev = out[out.length - 1];
    if (isPhoto && prev?.type === 'photos' && prev.date === e.date && prev.actor === e.actor) prev.photos.push(e);
    else if (isPhoto) out.push({ type: 'photos', key: `photos-${e.key}`, date: e.date, actor: e.actor, photos: [e], tab: 'documents' });
    else out.push(e);
  }
  return out;
}

/** Frise chronologique d'un véhicule. `onOpenTab(tab)` ouvre l'onglet de l'élément cliqué. */
export default function History({ vehicleId, onOpenTab }) {
  const { data } = useLoad(() => api.get(`/vehicles/${vehicleId}/history`), [vehicleId]);
  const [hidden, setHidden] = useState(() => new Set());
  const [viewer, setViewer] = useState(null); // { images, start }
  const now = today();

  const events = data?.events ?? [];
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  const { upcoming, groups } = useMemo(() => {
    const visible = events.filter((e) => e.type === 'vehicle' || !hidden.has(e.type));
    const grouped = groupPhotos(visible);
    const future = grouped.filter((e) => e.date > now).reverse(); // le plus proche d'abord
    const byMonth = [];
    for (const e of grouped.filter((x) => x.date <= now)) {
      const title = monthTitle(e.date);
      const last = byMonth[byMonth.length - 1];
      if (last?.title === title) last.events.push(e); else byMonth.push({ title, events: [e] });
    }
    return { upcoming: future, groups: byMonth };
  }, [events, hidden, now]);

  const toggle = (id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!data) return <p className="muted">Chargement…</p>;

  return (
    <div className="history">
      <div className="chips" role="group" aria-label="Filtrer l'historique">
        {FILTERS.filter((f) => counts[f.id]).map((f) => (
          <button key={f.id} type="button" className={`chip${hidden.has(f.id) ? '' : ' on'}`} aria-pressed={!hidden.has(f.id)} onClick={() => toggle(f.id)}>
            {f.label} <span className="count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {upcoming.length > 0 && <Section title="À venir" events={upcoming} now={now} onOpenTab={onOpenTab} setViewer={setViewer} />}
      {groups.map((g) => <Section key={g.title} title={g.title} events={g.events} now={now} onOpenTab={onOpenTab} setViewer={setViewer} />)}
      {data.truncated && <p className="muted">Historique tronqué : seuls les 1 000 événements les plus récents sont affichés.</p>}

      {viewer && <Lightbox images={viewer.images} start={viewer.start} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Section({ title, events, now, onOpenTab, setViewer }) {
  return (
    <section className="tl-section">
      <h3 className="tl-month">{title}</h3>
      <ol className="timeline">
        {events.map((e) => <Item key={e.key} e={e} now={now} onOpenTab={onOpenTab} setViewer={setViewer} />)}
      </ol>
    </section>
  );
}

function Item({ e, now, onOpenTab, setViewer }) {
  const future = e.date > now;
  const icon = e.type === 'photos' || (e.type === 'document' && e.isImage) ? ICONS.photo : ICONS[e.type];

  let title = e.title;
  let meta = null;
  let badge = null;
  switch (e.type) {
    case 'intervention':
      badge = <span className={`badge st-${e.status}`}>{LABELS.interventionStatus[e.status]}</span>;
      meta = [LABELS.kind[e.kind], e.category, e.cost ? money(e.cost) : null].filter(Boolean).join(' · ');
      break;
    case 'transaction':
      badge = <span className={`badge ${e.direction === 'revenu' ? 'st-termine' : 'st-annule'}`}>{e.direction === 'revenu' ? '+' : '−'} {money(e.amount)}</span>;
      meta = [LABELS.txCategory[e.category], e.intervention].filter(Boolean).join(' · ');
      break;
    case 'task':
      badge = <span className={`badge st-${e.status === 'fait' ? 'termine' : e.status === 'en_cours' ? 'en_cours' : 'planifie'}`}>{LABELS.taskStatus[e.status]}</span>;
      meta = [e.priority === 'haute' && '🔥 haute', e.status !== 'fait' && e.dueDate && `pour le ${date(e.dueDate)}`, e.assignee].filter(Boolean).join(' · ');
      break;
    case 'document':
      meta = [LABELS.docCategory[e.category], e.on && `sur ${ON_LABEL[e.on.kind]} « ${e.on.title} »`].filter(Boolean).join(' · ');
      break;
    case 'photos':
      title = e.photos.length > 1 ? `${e.photos.length} photos ajoutées` : 'Photo ajoutée';
      break;
    case 'comment':
      title = `« ${e.title} »`;
      meta = e.on ? `sur ${ON_LABEL[e.on.kind]} « ${e.on.title} »` : null;
      break;
    default:
  }

  const open = () => onOpenTab(e.tab);
  const shown = e.type === 'photos' ? e.photos.slice(0, 8) : [];

  return (
    <li className={`tl-item t-${e.type}${future ? ' future' : ''}`}>
      <span className="tl-icon" aria-hidden="true">{icon}</span>
      <div className="tl-card">
        <button type="button" className="tl-main" onClick={open} title="Ouvrir dans l'onglet correspondant">
          <span className="tl-date">{date(e.date)}{future && ' · prévu'}</span>
          <span className="tl-title">{title}</span>
          {badge}
          {meta && <span className="muted tl-meta">{meta}</span>}
          {e.actor && <span className="muted tl-meta">👤 {e.actor}</span>}
        </button>
        {e.type === 'document' && e.isImage && (
          <button type="button" className="tl-thumb" onClick={() => setViewer({ images: [e], start: 0 })} aria-label={`Voir ${e.title}`}>
            <img src={thumb(e.thumbUrl, 320)} alt="" loading="lazy" />
          </button>
        )}
        {shown.length > 0 && (
          <div className="tl-photos">
            {shown.map((p, i) => (
              <button key={p.id} type="button" className="tl-thumb" onClick={() => setViewer({ images: e.photos, start: i })} aria-label={`Voir ${p.title}`}>
                <img src={thumb(p.thumbUrl, 320)} alt="" loading="lazy" />
              </button>
            ))}
            {e.photos.length > shown.length && <span className="muted">+{e.photos.length - shown.length}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
