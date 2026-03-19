import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import AdminPages from './pages/admin/LandingPages';
import AdminUsers from './pages/admin/Users';
import AdminSettings from './pages/admin/Settings';
import AdminBots from './pages/admin/BotProtection';
import AdminVisitors from './pages/admin/VisitorLogs';
import UserHome from './pages/user/Home';
import UserFiles from './pages/user/Files';
import UserDomains from './pages/user/Domains';
import UserLinks from './pages/user/Links';
import UserAnalytics from './pages/user/Analytics';

function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#64748b' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to={user.role === 'Admin' ? '/admin' : '/user'} />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={
          loading ? null : user ? <Navigate to={user.role === 'Admin' ? '/admin' : '/user'} /> : <Login />
        } />

        <Route path="/admin" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
        <Route path="/admin/pages" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminPages /></Layout></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminUsers /></Layout></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminSettings /></Layout></ProtectedRoute>} />
        <Route path="/admin/bots" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminBots /></Layout></ProtectedRoute>} />
        <Route path="/admin/visitors" element={<ProtectedRoute requiredRole="Admin"><Layout><AdminVisitors /></Layout></ProtectedRoute>} />

        <Route path="/user" element={<ProtectedRoute><Layout><UserHome /></Layout></ProtectedRoute>} />
        <Route path="/user/files" element={<ProtectedRoute><Layout><UserFiles /></Layout></ProtectedRoute>} />
        <Route path="/user/domains" element={<ProtectedRoute><Layout><UserDomains /></Layout></ProtectedRoute>} />
        <Route path="/user/links" element={<ProtectedRoute><Layout><UserLinks /></Layout></ProtectedRoute>} />
        <Route path="/user/analytics" element={<ProtectedRoute><Layout><UserAnalytics /></Layout></ProtectedRoute>} />

        <Route path="/" element={
          loading ? null : user ? <Navigate to={user.role === 'Admin' ? '/admin' : '/user'} /> : <Navigate to="/login" />
        } />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </ToastProvider>
  );
}
