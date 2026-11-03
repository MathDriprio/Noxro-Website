import { useState } from 'react';
import { api } from '../api.js';
import { LABELS, localIso, money, options } from '../format.js';
import { useLoad } from '../hooks.js';
import { Transactions } from './vehicleTabs.jsx';

const PERIODS = {
  all: { label: 'Tout' },
  month: { label: 'Ce mois-ci', range: () => { const n = new Date(); return [localIso(new Date(n.getFullYear(), n.getMonth(), 1)), localIso(new Date(n.getFullYear(), n.getMonth() + 1, 0))]; } },
  year: { label: 'Cette année', range: () => { const y = new Date().getFullYear(); return [`${y}-01-01`, `${y}-12-31`]; } },
};

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportCsv(rows) {
  const head = ['Date', 'Sens', 'Catégorie', 'Libellé', 'Montant (€)', 'Véhicule', 'Intervention', 'Notes'];
  const lines = rows.map((t) => [
    t.occurredOn, LABELS.direction[t.direction], LABELS.txCategory[t.category], t.label,
    String(t.amount).replace('.', ','), t.vehicleName ?? 'Garage', t.interventionTitle ?? '', t.notes ?? '',
  ]);
  // BOM + point-virgule : s'ouvre correctement dans Excel / LibreOffice en français
  const csv = `﻿${[head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `depenses-${localIso(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ExpensesPage() {
  const [period, setPeriod] = useState('all');
  const [category, setCategory] = useState('');
  const [direction, setDirection] = useState('');
  const [scope, setScope] = useState('');
  const [result, setResult] = useState(null);
  const vehicles = useLoad(() => api.get('/vehicles?status=all'), []);

  const [from, to] = PERIODS[period].range?.() ?? [];
  const query = {
    from, to,
    category: category || undefined,
    direction: direction || undefined,
    general: scope === 'garage' ? 'true' : undefined,
    vehicleId: /^\d+$/.test(scope) ? scope : undefined,
  };

  // dépenses par catégorie (barres proportionnelles)
  const byCategory = {};
  for (const t of result?.transactions ?? []) {
    if (t.direction === 'depense') byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
  }
  const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] ?? 1;

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="row between wrap">
          <h1 className="pink-title">Dépenses</h1>
          <div className="filters">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Période">
              {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
              <option value="">Toutes catégories</option>
              {options(LABELS.txCategory).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Sens">
              <option value="">Dépenses et revenus</option>
              {options(LABELS.direction).map((o) => <option key={o.value} value={o.value}>{o.label}s</option>)}
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Véhicule">
              <option value="">Tous les véhicules</option>
              <option value="garage">Garage (frais généraux)</option>
              {vehicles.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model}</option>)}
            </select>
            <button type="button" className="btn ghost small" disabled={!result?.transactions.length} onClick={() => exportCsv(result.transactions)}>Export CSV</button>
          </div>
        </div>

        {result && (
          <>
            <dl className="kpis wide">
              <div><dt>Dépenses</dt><dd>{money(result.totals.expenses)}</dd></div>
              <div><dt>Revenus</dt><dd>{money(result.totals.revenue)}</dd></div>
              <div><dt>Solde</dt><dd className={result.totals.net < 0 ? 'neg' : 'pos'}>{money(result.totals.net)}</dd></div>
            </dl>
            {cats.length > 0 && (
              <div className="bars" aria-label="Dépenses par catégorie">
                {cats.map(([c, v]) => (
                  <div key={c} className="bar-row">
                    <span className="bar-label">{LABELS.txCategory[c]}</span>
                    <span className="bar"><span style={{ width: `${(v / max) * 100}%` }} /></span>
                    <span className="bar-value">{money(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {vehicles.data && (
          <Transactions vehicles={vehicles.data.vehicles} query={query} onLoaded={setResult} />
        )}
      </div>
    </div>
  );
}
