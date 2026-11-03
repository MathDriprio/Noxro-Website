import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.displayName);
  const [nameError, setNameError] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState({});

  async function saveName(e) {
    e.preventDefault();
    setNameError('');
    if (!name.trim()) { setNameError('Champ obligatoire.'); return; }
    try {
      const r = await api.patch('/users/me', { displayName: name });
      setUser(r.user);
      toast('Nom mis à jour.');
    } catch (err) { setNameError(err.fields?.displayName ?? err.message); toast(err.message, 'error'); }
  }

  async function savePassword(e) {
    e.preventDefault();
    const errors = {};
    if (!pw.currentPassword) errors.currentPassword = 'Champ obligatoire.';
    if (pw.newPassword.length < 8) errors.newPassword = 'Au moins 8 caractères.';
    if (pw.newPassword !== pw.confirm) errors.confirm = 'Les mots de passe ne correspondent pas.';
    setPwErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      await api.patch('/users/me', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Mot de passe modifié.');
    } catch (err) { setPwErrors(Object.keys(err.fields).length ? err.fields : { currentPassword: err.message }); toast(err.message, 'error'); }
  }

  const pwField = (key, label, auto) => (
    <label className={`field${pwErrors[key] ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <input type="password" autoComplete={auto} value={pw[key]} onChange={(e) => { setPw({ ...pw, [key]: e.target.value }); setPwErrors({ ...pwErrors, [key]: undefined }); }} />
      {pwErrors[key] && <span className="field-error">{pwErrors[key]}</span>}
    </label>
  );

  return (
    <div className="panel profile">
      <div className="panel-body">
        <h1 className="pink-title">Mon profil</h1>
        <p className="muted">{user.email}{user.isAdmin && ' · administrateur'}</p>

        <form className="form" onSubmit={saveName} noValidate>
          <label className={`field${nameError ? ' has-error' : ''}`}>
            <span className="field-label">Nom affiché</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setNameError(''); }} />
            {nameError && <span className="field-error">{nameError}</span>}
          </label>
          <button className="btn" type="submit">Enregistrer</button>
        </form>

        <form className="form" onSubmit={savePassword} noValidate>
          <h3>Changer le mot de passe</h3>
          {pwField('currentPassword', 'Mot de passe actuel', 'current-password')}
          {pwField('newPassword', 'Nouveau mot de passe (8 caractères min.)', 'new-password')}
          {pwField('confirm', 'Confirmer le nouveau mot de passe', 'new-password')}
          <button className="btn" type="submit">Changer le mot de passe</button>
        </form>
      </div>
    </div>
  );
}
