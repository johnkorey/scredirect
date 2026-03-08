import React, { useEffect, useState } from 'react';
import api from '../../api';

export default function Dashboard() {
  const [stats, setStats] = useState({});
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
    api.getActivity().then(setActivity).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-header"><div><h1>Dashboard</h1><p>Overview of your landing pages system.</p></div></div>

      <div className="stats-grid">
        <div className="stat-card stat-purple">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg></div>
          <div><div className="stat-value">{stats.pages || 0}</div><div className="stat-label">Landing Pages</div></div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3z"/></svg></div>
          <div><div className="stat-value">{stats.users || 0}</div><div className="stat-label">Users</div></div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/></svg></div>
          <div><div className="stat-value">{stats.versions || 0}</div><div className="stat-label">File Versions</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg></div>
          <div><div className="stat-value">{stats.domains || 0}</div><div className="stat-label">Domains</div></div>
        </div>
      </div>

      <div className="section-card">
        <h3>Recent Activity</h3>
        <p className="desc">Latest actions in the system.</p>
        {activity.length === 0 ? (
          <p style={{ color: '#475569', fontSize: '0.85rem' }}>No activity yet.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Action</th><th>Details</th><th>User</th><th>Date</th></tr></thead>
            <tbody>
              {activity.slice(0, 15).map((a, i) => (
                <tr key={i}>
                  <td><span className="badge badge-blue">{a.action}</span></td>
                  <td>{a.details}</td>
                  <td style={{ color: '#94a3b8' }}>{a.user_name}</td>
                  <td style={{ color: '#64748b' }}>{a.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
