import { useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { useToast } from '../toast.jsx';

const when = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** target : { vehicleId } | { interventionId } | { transactionId } | { taskId } | { documentId } */
export default function Comments({ target, onChange }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get(`/comments${qs(target)}`), [JSON.stringify(target)]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  async function act(fn) {
    try { await fn(); await reload(); onChange?.(); } catch (e) { setError(e.fields?.body ?? e.message); toast(e.message, 'error'); }
  }

  const add = (e) => {
    e.preventDefault();
    setError('');
    if (!text.trim()) { setError('Le commentaire ne peut pas être vide.'); return; }
    act(async () => { await api.post('/comments', { ...target, body: text }); setText(''); });
  };

  return (
    <div className="comments">
      {data?.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="comment-head">
            <strong>{c.authorName ?? 'Ancien utilisateur'}</strong>
            <span className="muted">{when(c.createdAt)}{c.edited && ' · modifié'}</span>
            {(c.authorId === user.id || user.isAdmin) && editing !== c.id && (
              <span className="comment-actions">
                {c.authorId === user.id && <button type="button" className="link" onClick={() => setEditing(c.id)}>Modifier</button>}
                <button type="button" className="link danger" onClick={() => window.confirm('Supprimer ce commentaire ?') && act(() => api.del(`/comments/${c.id}`))}>Supprimer</button>
              </span>
            )}
          </div>
          {editing === c.id
            ? <EditBox initial={c.body} onCancel={() => setEditing(null)} onSave={(body) => act(async () => { await api.patch(`/comments/${c.id}`, { body }); setEditing(null); })} />
            : <p className="comment-body">{c.body}</p>}
        </div>
      ))}
      {data && data.comments.length === 0 && <p className="muted">Aucun commentaire.</p>}
      <form onSubmit={add} className="comment-form" noValidate>
        <textarea rows={2} value={text} placeholder="Ajouter un commentaire…" onChange={(e) => { setText(e.target.value); setError(''); }} />
        {error && <span className="field-error">{error}</span>}
        <button type="submit" className="btn small">Publier</button>
      </form>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  return (
    <div className="comment-form">
      <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} />
      <span className="row">
        <button type="button" className="btn small" onClick={() => onSave(v)}>Enregistrer</button>
        <button type="button" className="btn ghost small" onClick={onCancel}>Annuler</button>
      </span>
    </div>
  );
}
