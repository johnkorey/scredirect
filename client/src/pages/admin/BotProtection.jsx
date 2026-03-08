import React, { useEffect, useState } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';

export default function BotProtection() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [blocksTotal, setBlocksTotal] = useState(0);
  const [blocksPage, setBlocksPage] = useState(1);
  const [ipList, setIpList] = useState([]);
  const [newIp, setNewIp] = useState('');
  const [newListType, setNewListType] = useState('block');
  const [newNote, setNewNote] = useState('');

  function loadStats() {
    api.getBotStats().then(setStats).catch(() => {});
  }
  function loadBlocks(page) {
    api.getBotBlocks(page, 50).then(data => {
      setBlocks(data.blocks);
      setBlocksTotal(data.total);
      setBlocksPage(data.page);
    }).catch(() => {});
  }
  function loadIpList() {
    api.getBotIpList().then(setIpList).catch(() => {});
  }

  useEffect(() => { loadStats(); loadBlocks(1); loadIpList(); }, []);

  function addIp(e) {
    e.preventDefault();
    if (!newIp.trim()) return;
    api.addBotIp({ ip: newIp.trim(), listType: newListType, note: newNote }).then(() => {
      toast('IP added to ' + newListType + ' list');
      setNewIp(''); setNewNote('');
      loadIpList(); loadStats();
    }).catch(err => toast(err.message));
  }

  function removeIp(id) {
    api.removeBotIp(id).then(() => {
      toast('IP removed');
      loadIpList(); loadStats();
    }).catch(err => toast(err.message));
  }

  function clearLogs() {
    if (!confirm('Clear all block logs?')) return;
    api.clearBotBlocks().then(() => {
      toast('Block logs cleared');
      loadBlocks(1); loadStats();
    }).catch(err => toast(err.message));
  }

  function typeBadge(type) {
    const colors = {
      ua_blocked: '#ef4444', rate_limited: '#f59e0b', challenge_fail: '#f97316',
      honeypot: '#ec4899', brute_force: '#dc2626', ip_blocklist: '#6366f1', header_anomaly: '#8b5cf6'
    };
    const bg = colors[type] || '#64748b';
    return <span style={{ background: bg + '22', color: bg, padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600 }}>{type}</span>;
  }

  const totalPages = Math.ceil(blocksTotal / 50);

  return (
    <div>
      <div className="page-header">
        <div><h1>Bot Protection</h1><p>Monitor and manage automated traffic blocking.</p></div>
        <button className="btn btn-outline" onClick={clearLogs}>Clear Logs</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card stat-red">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></div>
          <div><div className="stat-value">{stats?.total || 0}</div><div className="stat-label">Total Blocked</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></div>
          <div><div className="stat-value">{stats?.today || 0}</div><div className="stat-label">Blocked Today</div></div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></div>
          <div><div className="stat-value">{stats?.byType?.[0]?.block_type || '-'}</div><div className="stat-label">Top Block Type</div></div>
        </div>
        <div className="stat-card stat-purple">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z"/></svg></div>
          <div><div className="stat-value">{stats?.blocklisted || 0}</div><div className="stat-label">IPs Blocklisted</div></div>
        </div>
      </div>

      {/* Block type breakdown */}
      {stats?.byType?.length > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <h3>Block Type Breakdown</h3>
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Type</th><th>Count</th><th>Percentage</th></tr></thead>
            <tbody>
              {stats.byType.map(t => (
                <tr key={t.block_type}>
                  <td>{typeBadge(t.block_type)}</td>
                  <td style={{ fontWeight: 600 }}>{t.count}</td>
                  <td>{stats.total ? Math.round(t.count / stats.total * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* IP Management */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <h3>IP Management</h3>
        <form onSubmit={addIp} style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <input className="input" placeholder="IP address" value={newIp} onChange={e => setNewIp(e.target.value)} style={{ flex: '1 1 160px' }} />
          <select className="input" value={newListType} onChange={e => setNewListType(e.target.value)} style={{ width: 120 }}>
            <option value="block">Block</option>
            <option value="allow">Allow</option>
          </select>
          <input className="input" placeholder="Note (optional)" value={newNote} onChange={e => setNewNote(e.target.value)} style={{ flex: '1 1 160px' }} />
          <button type="submit" className="btn btn-primary">Add IP</button>
        </form>

        {ipList.length > 0 && (
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead><tr><th>IP</th><th>List</th><th>Note</th><th>Added</th><th>Actions</th></tr></thead>
            <tbody>
              {ipList.map(entry => (
                <tr key={entry.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{entry.ip}</td>
                  <td>
                    <span className={entry.list_type === 'block' ? 'badge badge-red' : 'badge badge-green'}>
                      {entry.list_type === 'block' ? 'Blocked' : 'Allowed'}
                    </span>
                  </td>
                  <td style={{ color: '#94a3b8' }}>{entry.note || '-'}</td>
                  <td style={{ color: '#64748b', fontSize: '0.82rem' }}>{entry.created?.split('T')[0]}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => removeIp(entry.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent blocked requests */}
      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2230', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent Blocked Requests</h3>
          <span style={{ color: '#64748b', fontSize: '0.82rem' }}>{blocksTotal} total</span>
        </div>
        {blocks.length === 0 ? (
          <div className="empty-state"><p>No blocked requests yet.</p></div>
        ) : (
          <>
            <table className="data-table">
              <thead><tr><th>IP</th><th>User Agent</th><th>Reason</th><th>Type</th><th>Path</th><th>Time</th></tr></thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.82rem' }}>{b.ip}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', fontSize: '0.78rem' }} title={b.user_agent}>{b.user_agent || '-'}</td>
                    <td style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>{b.reason}</td>
                    <td>{typeBadge(b.block_type)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#64748b' }}>{b.path || '-'}</td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>{b.created?.replace('T', ' ').substring(0, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
                <button className="btn btn-outline btn-sm" disabled={blocksPage <= 1} onClick={() => loadBlocks(blocksPage - 1)}>Prev</button>
                <span style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: '32px' }}>Page {blocksPage} of {totalPages}</span>
                <button className="btn btn-outline btn-sm" disabled={blocksPage >= totalPages} onClick={() => loadBlocks(blocksPage + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Top IPs */}
      {stats?.topIps?.length > 0 && (
        <div className="section-card" style={{ marginTop: 20 }}>
          <h3>Top Blocked IPs</h3>
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead><tr><th>IP</th><th>Blocks</th><th>Actions</th></tr></thead>
            <tbody>
              {stats.topIps.map(t => (
                <tr key={t.ip}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.ip}</td>
                  <td style={{ fontWeight: 600 }}>{t.count}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      api.addBotIp({ ip: t.ip, listType: 'block', note: 'Blocked from dashboard' }).then(() => {
                        toast('IP blocklisted');
                        loadIpList(); loadStats();
                      }).catch(err => toast(err.message));
                    }}>Blocklist</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
