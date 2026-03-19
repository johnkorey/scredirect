import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

export default function Domains() {
  const toast = useToast();
  const [domains, setDomains] = useState([]);
  const [pages, setPages] = useState([]);
  const [dnsConfig, setDnsConfig] = useState({ serverIp: '', serverHostname: '', dnsType: 'A', dnsValue: '' });
  const [modal, setModal] = useState(false);
  const [dnsModal, setDnsModal] = useState(false);
  const [dnsModalDomain, setDnsModalDomain] = useState('');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ domain: '', pageId: '', autoSSL: true, notes: '' });
  const [verifying, setVerifying] = useState({});

  function load() {
    api.getDomains().then(setDomains).catch(() => {});
    api.getPages().then(setPages).catch(() => {});
    api.getDnsConfig().then(setDnsConfig).catch(() => {});
  }
  useEffect(load, []);

  const sslActive = domains.filter(d => d.ssl_active).length;
  const noSSL = domains.filter(d => !d.ssl_active).length;

  function openNew() {
    setEditId(null);
    setForm({ domain: '', pageId: '', autoSSL: true, notes: '' });
    setModal(true);
  }

  function openEdit(d) {
    setEditId(d.id);
    setForm({ domain: d.domain, pageId: d.page_id || '', autoSSL: !!d.auto_ssl, notes: d.notes || '' });
    setModal(true);
  }

  async function save() {
    if (!form.domain.trim()) { toast('Domain name required'); return; }
    try {
      if (editId) {
        await api.updateDomain(editId, form);
        toast('Domain updated');
        setModal(false);
      } else {
        await api.createDomain(form);
        toast('Domain added');
        setModal(false);
        // Show DNS info after adding
        showDnsInfo(form.domain);
      }
      load();
    } catch (err) { toast(err.message); }
  }

  async function del(id) {
    if (!confirm('Delete this domain?')) return;
    try { await api.deleteDomain(id); toast('Domain deleted'); load(); }
    catch (err) { toast(err.message); }
  }

  async function handleVerify(id) {
    setVerifying(v => ({ ...v, [id]: true }));
    try {
      const result = await api.verifyDns(id);
      if (result.verified) {
        toast('DNS verified! You can now install SSL.');
      } else {
        toast('DNS not propagated yet. Current: ' + (result.current || 'none') + ', Expected: ' + (result.expected || ''));
      }
      load();
    } catch (err) { toast(err.message); }
    finally { setVerifying(v => ({ ...v, [id]: false })); }
  }

  async function handleSSL(id, action) {
    try {
      await api.domainSSL(id, action);
      toast('SSL ' + (action === 'generate' ? 'installed' : 'renewed'));
      load();
    } catch (err) { toast(err.message); }
  }

  function showDnsInfo(domain) {
    setDnsModalDomain(domain);
    setDnsModal(true);
  }

  function copyValue(text) {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast('Copy failed'));
  }

  function getDnsName(domain) {
    const parts = domain.split('.');
    return parts.length > 2 ? parts[0] : '@';
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>My Domains</h1><p>Add and manage custom domains for your landing pages.</p></div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Domain</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg></div>
          <div><div className="stat-value">{domains.length}</div><div className="stat-label">Total Domains</div></div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg></div>
          <div><div className="stat-value">{sslActive}</div><div className="stat-label">SSL Active</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></div>
          <div><div className="stat-value">{noSSL}</div><div className="stat-label">No SSL</div></div>
        </div>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {domains.length === 0 ? (
          <div className="empty-state"><p>No domains added yet.</p><button className="btn btn-primary" onClick={openNew}>Add Your First Domain</button></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Domain</th><th>Landing Page</th><th>DNS Status</th><th>SSL</th><th>Added</th><th>Actions</th></tr></thead>
            <tbody>
              {domains.map(d => {
                const pageName = pages.find(p => p.id === d.page_id)?.name || '-';
                return (
                  <tr key={d.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#60a5fa' }}>{d.domain}</div>
                      {d.notes && <div style={{ fontSize: '0.72rem', color: '#475569' }}>{d.notes}</div>}
                    </td>
                    <td>{pageName}</td>
                    <td>
                      <span className={'badge ' + (d.dns_verified ? 'badge-green' : 'badge-yellow')}>
                        {d.dns_verified ? 'Verified' : 'Pending'}
                      </span>
                      <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => showDnsInfo(d.domain)}>View DNS</button>
                        {!d.dns_verified && (
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '0.7rem' }}
                            onClick={() => handleVerify(d.id)}
                            disabled={verifying[d.id]}
                          >
                            {verifying[d.id] ? 'Checking...' : 'Verify DNS'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={'badge ' + (d.ssl_active ? 'badge-green' : 'badge-yellow')}>{d.ssl_active ? 'Active' : 'Not Installed'}</span>
                      {d.ssl_date && <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 2 }}>{d.ssl_date}</div>}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{d.created}</td>
                    <td>
                      <div className="btn-row">
                        {d.dns_verified && !d.ssl_active && (
                          <button className="btn btn-success btn-sm" onClick={() => handleSSL(d.id, 'generate')}>Install SSL</button>
                        )}
                        {d.ssl_active && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleSSL(d.id, 'renew')}>Renew SSL</button>
                        )}
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(d)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => del(d.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-card" style={{ marginTop: 20 }}>
        <h3>DNS Setup Guide</h3>
        <p className="desc">Add these records at your DNS registrar to connect your domains to this server.</p>
        <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.8 }}>
          {!dnsConfig.dnsValue ? (
            <span style={{ color: '#facc15' }}>Server IP/hostname not configured yet. Ask your admin to set SERVER_IP or SERVER_HOSTNAME in settings.</span>
          ) : (
            <>
              <strong style={{ color: '#f1f5f9' }}>Required DNS Record</strong><br/><br/>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 12px', padding: 12, background: '#161922', borderRadius: 8, border: '1px solid #1e2230' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Type</span>
                <span style={{ color: '#818cf8', fontWeight: 600 }}>{dnsConfig.dnsType}</span>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Name</span>
                <span>@ (or your subdomain)</span>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Value</span>
                <span>
                  <code style={{ color: '#34d399', background: '#0f1117', padding: '2px 8px', borderRadius: 4 }}>{dnsConfig.dnsValue}</code>
                  {' '}
                  <button className="btn btn-outline btn-sm" style={{ padding: '2px 6px', fontSize: '0.68rem' }} onClick={() => copyValue(dnsConfig.dnsValue)}>Copy</button>
                </span>
                <span style={{ color: '#64748b', fontWeight: 600 }}>TTL</span>
                <span>300 (or Auto)</span>
              </div>
              <br/>
              <strong style={{ color: '#f1f5f9' }}>Steps</strong><br/>
              1. Add the DNS record above at your domain registrar<br/>
              2. Wait for DNS propagation (can take up to 24-48 hours)<br/>
              3. Click "Verify DNS" next to your domain to confirm<br/>
              4. Once verified, click "Install SSL" to auto-install a certificate
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Domain Modal */}
      <Modal
        title={editId ? 'Edit Domain' : 'Add Domain'}
        show={modal}
        onClose={() => setModal(false)}
        footer={<>
          <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Domain</button>
        </>}
      >
        <div className="form-group">
          <label>Domain Name</label>
          <input className="form-input" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} placeholder="e.g. download.myapp.com" />
        </div>
        <div className="form-group">
          <label>Assign to Landing Page</label>
          <select className="form-select" value={form.pageId} onChange={e => setForm({ ...form, pageId: e.target.value })}>
            <option value="">-- None --</option>
            {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Auto SSL</label>
          <select className="form-select" value={form.autoSSL ? 'yes' : 'no'} onChange={e => setForm({ ...form, autoSSL: e.target.value === 'yes' })}>
            <option value="yes">Yes - Auto-install Let's Encrypt</option>
            <option value="no">No - I'll handle SSL myself</option>
          </select>
        </div>
        <div className="form-group">
          <label>Notes (optional)</label>
          <input className="form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Main download domain" />
        </div>
      </Modal>

      {/* DNS Info Modal */}
      <Modal
        title={'DNS Records for ' + dnsModalDomain}
        show={dnsModal}
        onClose={() => setDnsModal(false)}
        footer={<button className="btn btn-primary" onClick={() => setDnsModal(false)}>Done</button>}
      >
        <div style={{ padding: 16, background: '#0f1117', borderRadius: 10, border: '1px solid #1e2230' }}>
          <h4 style={{ color: '#fff', fontSize: '0.9rem', marginBottom: 12 }}>Configure DNS Records</h4>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 14 }}>
            Add the following record at your domain registrar's DNS management portal:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', padding: 14, background: '#161922', borderRadius: 8, border: '1px solid #1e2230' }}>
            <span style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>Type</span>
            <span style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.85rem' }}>{dnsConfig.dnsType || 'A'}</span>
            <span style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>Name</span>
            <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{getDnsName(dnsModalDomain)}</span>
            <span style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>Value</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ color: '#34d399', fontSize: '0.85rem', background: '#0f1117', padding: '2px 8px', borderRadius: 4 }}>
                {dnsConfig.dnsValue || 'Not configured'}
              </code>
              {dnsConfig.dnsValue && (
                <button className="btn btn-outline btn-sm" style={{ padding: '3px 8px', fontSize: '0.7rem' }} onClick={() => copyValue(dnsConfig.dnsValue)}>Copy</button>
              )}
            </div>
            <span style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>TTL</span>
            <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>300 (or Auto)</span>
          </div>
          <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 12 }}>
            DNS changes can take up to 24-48 hours to propagate. Use the "Verify DNS" button in the domains table to check.
          </p>
        </div>
      </Modal>
    </div>
  );
}
