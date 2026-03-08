import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'Admin' ? '/admin' : '/user');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={handleSubmit}>
        <h1>SC Landing Pages</h1>
        <p className="sub">Sign in to your account.</p>
        {error && <p className="error">{error}</p>}
        <div className="form-group">
          <label>Email</label>
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@admin.com" required />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', padding: '11px', marginTop: 6 }} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.75rem', color: '#475569' }}>
          Default admin: admin@admin.com / admin123
        </p>
      </form>
    </div>
  );
}
