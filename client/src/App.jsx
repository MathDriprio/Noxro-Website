import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
import Home from './pages/Home.jsx';
import { Login, Register } from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import VehicleDetail from './pages/VehicleDetail.jsx';
import Vehicles from './pages/Vehicles.jsx';
import TasksPage from './pages/TasksPage.jsx';
import { ToastProvider } from './toast.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/connexion" element={<Login />} />
            <Route path="/inscription/:token" element={<Register />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="/voitures" element={<Vehicles />} />
              <Route path="/voitures/:id" element={<VehicleDetail />} />
              <Route path="/taches" element={<TasksPage />} />
              <Route path="/depenses" element={<ExpensesPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/profil" element={<Profile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
