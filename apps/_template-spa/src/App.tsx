import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './lib/auth';
import { Login } from './pages/Login';
import { AuthCallback } from './pages/AuthCallback';
import { Dashboard } from './pages/Dashboard';
import { UserManagement } from './pages/UserManagement';
import { Topbar } from './components/Topbar';

function Footer() {
  return (
    <footer className="flex items-center justify-center gap-2 px-4 pt-6 pb-4 text-text-tertiary text-[0.65rem] tracking-wide">
      <img
        src="/gz-logo-white.png"
        alt="Goal Zero"
        className="h-3 opacity-25"
      />
      <span>v{__APP_VERSION__}</span>
    </footer>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return (
    <>
      <Topbar />
      {children}
      <Footer />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
