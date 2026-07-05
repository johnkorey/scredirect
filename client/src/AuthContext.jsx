import React, { createContext, useContext, useState, useEffect } from 'react';
import api from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const r = await api.me();
      setUser(r.user);
      return r.user;
    } catch {
      setUser(null);
      return null;
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // Refresh every 60s so license countdown / admin actions propagate without re-login.
    const id = setInterval(() => { refresh(); }, 60000);
    return () => clearInterval(id);
  }, []);

  async function login(email, password) {
    const r = await api.login(email, password);
    // login() returns the legacy session shape; pull the fresh license-enriched user from /api/auth/me
    await refresh();
    return r.user;
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
