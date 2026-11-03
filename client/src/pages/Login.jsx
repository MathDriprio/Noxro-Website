import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';

// Page de connexion minimale : le design définitif viendra plus tard.
export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await login(form.email, form.password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) { setError(err.message); }
  }
  return (
    <AuthShell title="Connexion">
      <form onSubmit={submit} className="form">
        <label className="field"><span className="field-label">Email</span>
          <input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label className="field"><span className="field-label">Mot de passe</span>
          <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        {error && <p className="field-error">{error}</p>}
        <button className="btn" type="submit">Entrer</button>
        <p className="muted">Pas de compte ? L'inscription se fait sur invitation.</p>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { token } = useParams();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [errors, setErrors] = useState({});
  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    try {
      await register({ ...form, token });
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { _: err.message });
    }
  }
  const field = (name, label, type = 'text', auto) => (
    <label className={`field${errors[name] ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <input type={type} autoComplete={auto} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
      {errors[name] && <span className="field-error">{errors[name]}</span>}
    </label>
  );
  return (
    <AuthShell title="Inscription">
      <form onSubmit={submit} className="form" noValidate>
        {field('email', 'Email', 'email', 'username')}
        {field('displayName', 'Nom affiché', 'text', 'nickname')}
        {field('password', 'Mot de passe (8 caractères min.)', 'password', 'new-password')}
        {errors._ && <p className="field-error">{errors._}</p>}
        <button className="btn" type="submit">Créer mon compte</button>
      </form>
    </AuthShell>
  );
}

function AuthShell({ title, children }) {
  return (
    <div className="center-screen">
      <div className="panel auth-card">
        <div className="panel-body">
          <span className="logo big" />
          <h1 className="pink-title">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
