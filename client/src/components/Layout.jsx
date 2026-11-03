import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import ThemePicker from './ThemePicker.jsx';

const LINKS = [
  { to: '/voitures', label: 'Les voitures' },
  { to: '/taches', label: 'Tâches' },
  { to: '/depenses', label: 'Dépenses' },
  { to: '/documents', label: 'Documents' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="app">
      <header className="navbar">
        <button type="button" className="burger" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          <span /><span /><span />
        </button>
        <nav className={`nav-links${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/" end className="brand" aria-label="Accueil"><span className="logo" /></NavLink>
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} className="nav-link">{l.label}</NavLink>)}
        </nav>
        <div className="nav-user">
          <ThemePicker />
          <Link to="/profil" className="nav-name" title="Mon profil">{user?.displayName}</Link>
          <button type="button" className="btn ghost small" onClick={logout}>Quitter</button>
        </div>
      </header>
      <main className="page"><Outlet /></main>
    </div>
  );
}
