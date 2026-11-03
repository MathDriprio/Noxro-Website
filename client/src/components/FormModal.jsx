import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api.js';
import Modal from './Modal.jsx';
import { filesFromPaste } from '../hooks.js';
import { size } from '../format.js';
import { useToast } from '../toast.jsx';

/**
 * Formulaire générique.
 * fields : [{ name, label, type: text|number|date|select|textarea|checks|file, options, required, hint, placeholder, step,
 *             action: { label, run(values) -> { fill?: {champ: valeur} (si vide), set?: {champ: valeur}, message? } } }]
 * onSubmit(values) doit lever une ApiError pour afficher les erreurs sous les champs.
 */
export default function FormModal({ title, fields, initial = {}, submitLabel = 'Enregistrer', onSubmit, onClose }) {
  const toast = useToast();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? (f.type === 'checks' || f.type === 'file' ? [] : '')])));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState({});

  // Ctrl+V dans la fenêtre : les fichiers/images collés s'ajoutent au champ fichier
  const fileField = fields.find((f) => f.type === 'file');
  useEffect(() => {
    if (!fileField) return undefined;
    const onPaste = (e) => {
      const files = filesFromPaste(e);
      if (!files.length) return;
      e.preventDefault();
      setValues((s) => ({ ...s, [fileField.name]: [...s[fileField.name], ...(fileField.multiple ? files : files.slice(0, 1))] }));
      setErrors((er) => ({ ...er, [fileField.name]: undefined }));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [fileField]);

  const set = (name, v) => { setValues((s) => ({ ...s, [name]: v })); setErrors((e) => ({ ...e, [name]: undefined })); };

  async function runAction(f) {
    setErrors((e) => ({ ...e, [f.name]: undefined }));
    setNotes((n) => ({ ...n, [f.name]: undefined }));
    try {
      const r = await f.action.run(values);
      setValues((s) => {
        const next = { ...s, ...r.set };
        for (const [k, v] of Object.entries(r.fill ?? {})) if (s[k] === '' || s[k] == null) next[k] = v;
        return next;
      });
      setNotes((n) => ({ ...n, [f.name]: r.message }));
    } catch (err) {
      setErrors((e) => ({ ...e, [f.name]: err.message }));
    }
  }

  async function submit(e) {
    e.preventDefault();
    // validation locale avant envoi : champs obligatoires
    const local = {};
    for (const f of fields) {
      if (f.required && (values[f.name] === '' || values[f.name]?.length === 0)) local[f.name] = 'Champ obligatoire.';
    }
    if (Object.keys(local).length) { setErrors(local); return; }
    setBusy(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form">
        {fields.map((f) => (
          <label key={f.name} className={`field${errors[f.name] ? ' has-error' : ''}`}>
            <span className="field-label">{f.label}{f.required && ' *'}</span>
            <Input field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
            {f.action && (
              <button type="button" className="btn ghost small field-action" onClick={() => runAction(f)}>{f.action.label}</button>
            )}
            {notes[f.name] && !errors[f.name] && <span className="field-note">{notes[f.name]}</span>}
            {f.hint && !errors[f.name] && !notes[f.name] && <span className="field-hint">{f.hint}</span>}
            {errors[f.name] && <span className="field-error">{errors[f.name]}</span>}
          </label>
        ))}
        {errors._ && <p className="field-error">{errors._}</p>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Envoi…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function Input({ field: f, value, onChange }) {
  switch (f.type) {
    case 'textarea':
      return <textarea rows={4} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">— Aucun —</option>}
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'checks':
      return (
        <span className="checks">
          {f.options.length === 0 && <em>Aucun utilisateur.</em>}
          {f.options.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={value.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </span>
      );
    case 'file':
      return <FileInput field={f} files={value} onChange={onChange} />;
    default:
      return (
        <input
          type={f.type ?? 'text'}
          step={f.step}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Sélection de fichiers : bouton « parcourir » + liste (avec aperçu des images) où chaque fichier peut être retiré. */
function FileInput({ field: f, files, onChange }) {
  const previews = useMemo(() => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  return (
    <span className="file-input">
      <input
        type="file"
        multiple={f.multiple}
        accept={f.accept}
        value=""
        onChange={(e) => onChange(f.multiple ? [...files, ...e.target.files] : [...e.target.files].slice(0, 1))}
      />
      <span className="field-hint">Tu peux aussi coller une image (Ctrl+V).</span>
      {files.length > 0 && (
        <ul className="picked">
          {files.map((file, i) => (
            <li key={`${file.name}${file.size}${i}`}>
              {previews[i] ? <img src={previews[i]} alt="" /> : <span className="picked-ext">{file.name.split('.').pop().slice(0, 4)}</span>}
              <span className="picked-name">{file.name}<span className="muted"> · {size(file.size)}</span></span>
              <button type="button" className="icon-btn" onClick={() => onChange(files.filter((_, k) => k !== i))} aria-label={`Retirer ${file.name}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
