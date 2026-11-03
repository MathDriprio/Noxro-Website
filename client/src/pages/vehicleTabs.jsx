import { useState } from 'react';
import { api, qs } from '../api.js';
import Comments from '../components/Comments.jsx';
import Documents from '../components/Documents.jsx';
import FormModal from '../components/FormModal.jsx';
import { LABELS, date, money, options, today } from '../format.js';
import { useLoad } from '../hooks.js';
import { useToast } from '../toast.jsx';

const nul = (v) => (v === '' || v === undefined ? null : v);

/**
 * Envoie les factures choisies dans le formulaire d'une dépense. La dépense est déjà enregistrée :
 * en cas d'échec on prévient sans faire échouer le formulaire (sinon un nouvel envoi la dupliquerait).
 */
async function uploadInvoices(transactionId, files, toast) {
  if (!files?.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  fd.append('category', 'facture');
  fd.append('transactionId', transactionId);
  try { await api.post('/documents', fd); } catch (err) {
    toast(`Dépense enregistrée, mais la facture n'a pas pu être envoyée : ${err.message} Ajoute-la depuis le détail de la dépense.`, 'error');
  }
}

/** Liste générique : ajout / modification / suppression / détails dépliables (documents + commentaires). */
function CrudList({ load, deps, title, empty, readOnly, addLabel, fields, initialNew, toPayload, create, update, remove, renderRow, detailTarget, onChange }) {
  const toast = useToast();
  const { data, reload } = useLoad(load, deps);
  const [form, setForm] = useState(null); // { item? }
  const [open, setOpen] = useState(null);
  const items = data?.items ?? [];
  const refresh = () => { reload(); onChange?.(); };

  async function del(item) {
    if (!window.confirm('Supprimer cet élément ?')) return;
    try { await remove(item); toast('Supprimé.'); refresh(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div>
      <div className="row between">
        <h3>{title}{data?.header}</h3>
        {!readOnly && <button type="button" className="btn small" onClick={() => setForm({})}>{addLabel}</button>}
      </div>
      {items.length === 0 && data && <p className="muted">{empty}</p>}
      <ul className="item-list">
        {items.map((it) => (
          <li key={it.id} className="item">
            <div className="item-row">
              <button type="button" className="item-main" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                {renderRow(it)}
              </button>
              {!readOnly && (
                <span className="item-actions">
                  <button type="button" className="link" onClick={() => setForm({ item: it })}>Modifier</button>
                  <button type="button" className="link danger" onClick={() => del(it)}>Supprimer</button>
                </span>
              )}
            </div>
            {open === it.id && (
              <div className="item-detail">
                {it.description && <p>{it.description}</p>}
                {it.notes && <p>{it.notes}</p>}
                <h4>Documents</h4>
                <Documents target={detailTarget(it)} defaultCategory="facture" />
                <h4>Commentaires</h4>
                <Comments target={detailTarget(it)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {form && (
        <FormModal
          title={form.item ? 'Modifier' : addLabel.replace(/^\+ /, 'Ajouter : ')}
          fields={fields}
          initial={form.item ? toPayload.from(form.item) : initialNew}
          onSubmit={async (v) => { form.item ? await update(form.item, toPayload.to(v), v) : await create(toPayload.to(v), v); toast('Enregistré.'); refresh(); }}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}

export function Interventions({ vehicleId, readOnly, onChange }) {
  const fields = [
    { name: 'kind', label: 'Type', type: 'select', required: true, options: options(LABELS.kind) },
    { name: 'title', label: 'Intitulé', required: true, placeholder: 'Vidange, plaquettes avant…' },
    { name: 'category', label: 'Catégorie', placeholder: 'vidange, freins, pneus…' },
    { name: 'status', label: 'Statut', type: 'select', required: true, options: options(LABELS.interventionStatus) },
    { name: 'plannedDate', label: 'Date prévue', type: 'date', hint: 'Obligatoire si l\'intervention est planifiée.' },
    { name: 'doneDate', label: 'Date de réalisation', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ];
  const keys = fields.map((f) => f.name);
  return (
    <CrudList
      title="Entretiens & réparations" empty="Aucune intervention enregistrée." addLabel="+ Intervention" readOnly={readOnly} onChange={onChange}
      load={() => api.get(`/vehicles/${vehicleId}/interventions`).then((r) => ({ items: r.interventions }))} deps={[vehicleId]}
      fields={fields} initialNew={{ kind: 'entretien', status: 'planifie' }}
      toPayload={{
        from: (i) => Object.fromEntries(keys.map((k) => [k, i[k] ?? ''])),
        to: (v) => Object.fromEntries(keys.map((k) => [k, nul(v[k])])),
      }}
      create={(p) => api.post(`/vehicles/${vehicleId}/interventions`, p)}
      update={(i, p) => api.patch(`/interventions/${i.id}`, p)}
      remove={(i) => api.del(`/interventions/${i.id}`)}
      detailTarget={(i) => ({ interventionId: i.id })}
      renderRow={(i) => (
        <>
          <span className={`badge st-${i.status}`}>{LABELS.interventionStatus[i.status]}</span>
          <span className="item-title">{i.title}</span>
          <span className="muted">{LABELS.kind[i.kind]}{i.category && ` · ${i.category}`} · {date(i.doneDate ?? i.plannedDate)}{i.totalCost ? ` · ${money(i.totalCost)}` : ''}</span>
        </>
      )}
    />
  );
}

/**
 * Dépenses. Avec `vehicleId` : celles d'un véhicule. Sans : vue globale (frais généraux du garage inclus),
 * filtrable via `query` ; `onLoaded` reçoit la réponse (transactions + totaux) de la liste affichée.
 */
export function Transactions({ vehicleId, vehicles = [], query = {}, onLoaded, readOnly, onChange }) {
  const toast = useToast();
  const global = !vehicleId;
  const interventions = useLoad(
    () => (global ? Promise.resolve({ interventions: [] }) : api.get(`/vehicles/${vehicleId}/interventions`)),
    [vehicleId],
  );
  const fields = [
    { name: 'label', label: 'Libellé', required: true, placeholder: 'Plaquettes de frein' },
    { name: 'amount', label: 'Montant (€)', type: 'number', step: '0.01', required: true },
    { name: 'direction', label: 'Sens', type: 'select', required: true, options: options(LABELS.direction) },
    { name: 'category', label: 'Catégorie', type: 'select', required: true, options: options(LABELS.txCategory) },
    { name: 'occurredOn', label: 'Date', type: 'date', required: true },
    ...(global
      ? [{ name: 'vehicleId', label: 'Véhicule', type: 'select', hint: 'Aucun = frais généraux du garage.', options: vehicles.map((v) => ({ value: v.id, label: `${v.make} ${v.model}` })) }]
      : [{ name: 'interventionId', label: 'Intervention liée', type: 'select', options: (interventions.data?.interventions ?? []).map((i) => ({ value: i.id, label: i.title })) }]),
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'invoice', label: 'Facture', type: 'file', multiple: true, hint: 'PDF ou photo de la facture.' },
  ];
  const keys = fields.map((f) => f.name).filter((k) => k !== 'invoice'); // 'invoice' = fichiers, pas un champ de l'API
  return (
    <CrudList
      title={global ? '' : 'Dépenses'} empty="Aucune transaction." addLabel="+ Transaction" readOnly={readOnly} onChange={onChange}
      load={() => api.get(`/transactions${qs({ ...query, vehicleId: vehicleId ?? query.vehicleId })}`).then((r) => {
        onLoaded?.(r);
        return { items: r.transactions, header: global ? '' : ` — net ${money(r.totals.net)}` };
      })}
      deps={[vehicleId, JSON.stringify(query)]}
      fields={fields} initialNew={{ direction: 'depense', category: 'piece', occurredOn: today() }}
      toPayload={{
        from: (t) => Object.fromEntries(keys.map((k) => [k, t[k] ?? ''])),
        to: (v) => ({
          ...Object.fromEntries(keys.map((k) => [k, nul(v[k])])),
          amount: Number(String(v.amount).replace(',', '.')),
          ...(global ? { vehicleId: v.vehicleId ? Number(v.vehicleId) : null } : { vehicleId, interventionId: v.interventionId ? Number(v.interventionId) : null }),
        }),
      }}
      create={async (p, v) => { const r = await api.post('/transactions', p); await uploadInvoices(r.transaction.id, v.invoice, toast); }}
      update={async (t, p, v) => { await api.patch(`/transactions/${t.id}`, p); await uploadInvoices(t.id, v.invoice, toast); }}
      remove={(t) => api.del(`/transactions/${t.id}`)}
      detailTarget={(t) => ({ transactionId: t.id })}
      renderRow={(t) => (
        <>
          <span className={`badge ${t.direction === 'revenu' ? 'st-termine' : 'st-annule'}`}>{t.direction === 'revenu' ? '+' : '−'} {money(t.amount)}</span>
          <span className="item-title">{t.label}</span>
          <span className="muted">
            {LABELS.txCategory[t.category]} · {date(t.occurredOn)}
            {global && ` · ${t.vehicleName ?? 'Garage'}`}
            {t.interventionTitle && ` · ${t.interventionTitle}`}
            {t.documentCount > 0 && ` · 📎 ${t.documentCount}`}
          </span>
        </>
      )}
    />
  );
}

/** Tâches. Avec `vehicleId` : celles d'un véhicule. Sans : vue globale, filtrable via `query`. */
export function Tasks({ vehicleId, vehicles = [], users, query = {}, readOnly, onChange }) {
  const global = !vehicleId;
  const fields = [
    { name: 'title', label: 'Tâche', required: true, placeholder: 'Remplacer le filtre à air' },
    ...(global ? [{ name: 'vehicleId', label: 'Véhicule', type: 'select', hint: 'Aucun = tâche générale du garage.', options: vehicles.map((v) => ({ value: v.id, label: `${v.make} ${v.model}` })) }] : []),
    { name: 'status', label: 'Statut', type: 'select', required: true, options: options(LABELS.taskStatus) },
    { name: 'priority', label: 'Priorité', type: 'select', required: true, options: options(LABELS.priority) },
    { name: 'dueDate', label: 'Échéance', type: 'date' },
    { name: 'assigneeId', label: 'Responsable', type: 'select', options: users.map((u) => ({ value: u.id, label: u.displayName })) },
    { name: 'description', label: 'Description', type: 'textarea' },
  ];
  const keys = fields.map((f) => f.name);
  return (
    <CrudList
      title={global ? '' : 'Tâches'} empty="Aucune tâche." addLabel="+ Tâche" readOnly={readOnly} onChange={onChange}
      load={() => api.get(`/tasks${qs({ ...query, vehicleId: vehicleId ?? query.vehicleId })}`).then((r) => ({ items: r.tasks }))}
      deps={[vehicleId, JSON.stringify(query)]}
      fields={fields} initialNew={{ status: 'a_faire', priority: 'normale' }}
      toPayload={{
        from: (t) => Object.fromEntries(keys.map((k) => [k, t[k] ?? ''])),
        to: (v) => ({
          ...Object.fromEntries(keys.map((k) => [k, nul(v[k])])),
          assigneeId: v.assigneeId ? Number(v.assigneeId) : null,
          vehicleId: global ? (v.vehicleId ? Number(v.vehicleId) : null) : vehicleId,
        }),
      }}
      create={(p) => api.post('/tasks', p)}
      update={(t, p) => api.patch(`/tasks/${t.id}`, p)}
      remove={(t) => api.del(`/tasks/${t.id}`)}
      detailTarget={(t) => ({ taskId: t.id })}
      renderRow={(t) => (
        <>
          <span className={`badge st-${t.status === 'fait' ? 'termine' : t.status === 'en_cours' ? 'en_cours' : 'planifie'}`}>{LABELS.taskStatus[t.status]}</span>
          <span className={`item-title${t.status === 'fait' ? ' done' : ''}`}>{t.title}</span>
          <span className="muted">
            {t.priority === 'haute' && '🔥 Haute · '}{t.dueDate && `Pour le ${date(t.dueDate)} · `}{t.assigneeName ?? 'Non assignée'}
            {global && ` · ${t.vehicleName ?? 'Garage'}`}
          </span>
        </>
      )}
    />
  );
}
