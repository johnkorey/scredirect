import React, { useEffect, useState } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';

export default function VisitorLogs() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [filters, setFilters] = useState({ country: '', blocked: 'false', from: '', to: '' });
  const [activeFilters, setActiveFilters] = useState({ blocked: 'false' });

  function loadStats() {
    api.getVisitorStats().then(setStats).catch(() => {});
  }
  function loadLogs(page, f) {
    api.getVisitorLogs(page, 50, f || activeFilters).then(data => {
      setLogs(data.logs);
      setLogsTotal(data.total);
      setLogsPage(data.page);
    }).catch(() => {});
  }

  useEffect(() => { loadStats(); loadLogs(1, { blocked: 'false' }); }, []);

  function applyFilters(e) {
    e.preventDefault();
    setActiveFilters({ ...filters });
    loadLogs(1, filters);
  }
  function clearFilters() {
    const def = { country: '', blocked: 'false', from: '', to: '' };
    setFilters(def);
    setActiveFilters({ blocked: 'false' });
    loadLogs(1, { blocked: 'false' });
  }
  function clearLogs() {
    if (!confirm('Clear all visitor logs?')) return;
    api.clearVisitorLogs().then(() => {
      toast('Visitor logs cleared');
      loadLogs(1, activeFilters); loadStats();
    }).catch(err => toast(err.message));
  }

  const totalPages = Math.ceil(logsTotal / 50);

  return (
    <div>
      <div className="page-header">
        <div><h1>Visitor Analytics</h1><p>Human visitor statistics and geolocation data.</p></div>
        <button className="btn btn-outline" onClick={clearLogs}>Clear Logs</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card stat-purple">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div>
          <div><div className="stat-value">{stats?.total || 0}</div><div className="stat-label">Human Visitors</div></div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></div>
          <div><div className="stat-value">{stats?.uniqueIps || 0}</div><div className="stat-label">Unique IPs</div></div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg></div>
          <div><div className="stat-value">{stats?.today || 0}</div><div className="stat-label">Today</div></div>
        </div>
        <div className="stat-card stat-red">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></div>
          <div><div className="stat-value">{stats?.botsBlocked || 0}</div><div className="stat-label">Bots Blocked</div></div>
        </div>
      </div>

      {/* Top Countries & ISPs */}
      <div className="two-col" style={{ marginBottom: 20 }}>
        {stats?.topCountries?.length > 0 && (
          <div className="section-card">
            <h3>Top Countries</h3>
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead><tr><th>Country</th><th>Visitors</th><th>%</th></tr></thead>
              <tbody>
                {stats.topCountries.map(c => (
                  <tr key={c.country_code}>
                    <td><span style={{ fontWeight: 600 }}>{c.country_code}</span> <span style={{ color: '#94a3b8' }}>{c.country_name}</span></td>
                    <td style={{ fontWeight: 600 }}>{c.count}</td>
                    <td>{stats.total ? Math.round(c.count / stats.total * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stats?.topIsps?.length > 0 && (
          <div className="section-card">
            <h3>Top ISPs</h3>
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead><tr><th>ISP</th><th>Visitors</th></tr></thead>
              <tbody>
                {stats.topIsps.map(t => (
                  <tr key={t.isp}>
                    <td style={{ color: '#cbd5e1' }}>{t.isp}</td>
                    <td style={{ fontWeight: 600 }}>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <h3>Filter Logs</h3>
        <form onSubmit={applyFilters} style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Country Code</label>
            <input className="input" placeholder="e.g. US" value={filters.country} onChange={e => setFilters({ ...filters, country: e.target.value })} style={{ width: 90 }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 4 }}>From</label>
            <input className="input" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: 4 }}>To</label>
            <input className="input" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">Apply</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>Clear</button>
        </form>
      </div>

      {/* Visitor log table — human only */}
      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2230', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Human Visitors</h3>
          <span style={{ color: '#64748b', fontSize: '0.82rem' }}>{logsTotal} total</span>
        </div>
        {logs.length === 0 ? (
          <div className="empty-state"><p>No visitor logs yet.</p></div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>IP</th><th>Country</th><th>City</th><th>ISP</th><th>Path</th><th>Time</th></tr></thead>
                <tbody>
                  {logs.map(v => (
                    <tr key={v.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.82rem' }}>{v.ip}</td>
                      <td><span style={{ fontWeight: 600 }}>{v.country_code || '-'}</span> <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{v.country_name || ''}</span></td>
                      <td style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{v.city_name || '-'}</td>
                      <td style={{ color: '#94a3b8', fontSize: '0.82rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.isp}>{v.isp || '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#64748b' }}>{v.path || '-'}</td>
                      <td style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>{v.created?.replace('T', ' ').substring(0, 19)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
                <button className="btn btn-outline btn-sm" disabled={logsPage <= 1} onClick={() => loadLogs(logsPage - 1)}>Prev</button>
                <span style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: '32px' }}>Page {logsPage} of {totalPages}</span>
                <button className="btn btn-outline btn-sm" disabled={logsPage >= totalPages} onClick={() => loadLogs(logsPage + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
