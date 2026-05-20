import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../AuthContext';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [pages, setPages] = useState([]);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
    api.getPages().then(setPages).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-header"><div><h1>Welcome, {user?.name}</h1><p>Your dashboard overview.</p></div></div>

      <div className="stats-grid">
        <div className="stat-card stat-purple">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg></div>
          <div><div className="stat-value">{stats.pages || 0}</div><div className="stat-label">My Pages</div></div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/></svg></div>
          <div><div className="stat-value">{stats.versions || 0}</div><div className="stat-label">File Versions</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM12 7h5v2h-5zm0 4h5v2h-5zm0 4h5v2h-5zM7 7h2v2H7zm0 4h2v2H7zm0 4h2v2H7z"/></svg></div>
          <div><div className="stat-value">{stats.deployments || 0}</div><div className="stat-label">Deployments</div></div>
        </div>
      </div>

      <div className="two-col">
        <div className="section-card">
          <h3>My Landing Pages</h3>
          <p className="desc">Pages available for you to manage.</p>
          {pages.length === 0 ? (
            <p style={{ color: '#475569', fontSize: '0.85rem' }}>No landing pages yet. Ask your admin to create pages.</p>
          ) : (
            pages.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1e2230' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{p.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.created}</div>
                </div>
                <span className={'badge ' + (p.status === 'active' ? 'badge-green' : 'badge-yellow')}>{p.status}</span>
              </div>
            ))
          )}
        </div>
        <div className="section-card">
          <h3>Quick Actions</h3>
          <p className="desc">Common tasks.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => navigate('/user/files')}>Manage My Files</button>
            <button className="btn btn-outline" onClick={() => navigate('/user/analytics')}>View Analytics</button>
          </div>
        </div>
      </div>
    </div>
  );
}
