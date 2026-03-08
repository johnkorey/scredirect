import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

export default function Domains() {
  const toast = useToast();
  const [domains, setDomains] = useState([]);
  const [pages, setPages] = useState([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ domain: '', pageId: '', dnsType: 'A', dnsValue: '', autoSSL: true, notes: '' });

  function load() {
    api.getDomains().then(setDomains).catch(() => {});
    api.getPages().then(setPages).catch(() => {});
  }
  useEffect(load, []);

  const sslActive = domains.filter(d => d.ssl_active).length;
  const noSSL = domains.filter(d => !d.ssl_active).length;

  function openNew() {
    setEditId(null);
    setForm({ domain: '', pageId: '', dnsType: 'A', dnsValue: '', autoSSL: true, notes: '' });
    setModal(true);
  }

  function openEdit(d) {
    setEditId(d.id);
    setForm({ domain: d.domain, pageId: d.page_id || '', dnsType: d.dns_type || 'A', dnsValue: d.dns_value || '', autoSSL: !!d.auto_ssl, notes: d.notes || '' });
    setModal(true);
  }

  async function save() {
    if (!form.domain.trim()) { toast('Domain name required'); return; }
    try {
      if (editId) {
        await api.updateDomain(editId, form);
        toast('Domain updated');
      } else {
        await api.createDomain(form);
        toast('Domain added');
      }
      setModal(false);
      load();
    } catch (err) { toast(err.message); }
  }

  async function del(id) {
    if (!confirm('Delete this domain?')) return;
    try { await api.deleteDomain(id); toast('Domain deleted'); load(); }
    catch (err) { toast(err.message); }
  }

  async function handleSSL(id, action) {
    try {
      await api.domainSSL(id, action);
      toast('SSL ' + (action === 'generate' ? 'installed' : 'renewed'));
      load();
    } catch (err) { toast(err.message); }
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
            <thead><tr><th>Domain</th><th>Landing Page</th><th>DNS</th><th>SSL</th><th>Added</th><th>Actions</th></tr></thead>
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
                    <td><span className="badge badge-gray">{d.dns_type}: {d.dns_value || 'Not set'}</span></td>
                    <td>
                      <span className={'badge ' + (d.ssl_active ? 'badge-green' : 'badge-yellow')}>{d.ssl_active ? 'Active' : 'Not Installed'}</span>
                      {d.ssl_date && <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 2 }}>{d.ssl_date}</div>}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{d.created}</td>
                    <td>
                      <div className="btn-row">
                        {!d.ssl_active
                          ? <button className="btn btn-success btn-sm" onClick={() => handleSSL(d.id, 'generate')}>Generate SSL</button>
                          : <button className="btn btn-outline btn-sm" onClick={() => handleSSL(d.id, 'renew')}>Renew</button>
                        }
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
        <p className="desc">How to connect your domain to this server.</p>
        <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.8 }}>
          <strong style={{ color: '#f1f5f9' }}>Option 1: A Record</strong><br/>
          Point your domain's A record to your server IP address.<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>Option 2: CNAME</strong><br/>
          Create a CNAME record pointing to your main server hostname.<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>SSL Certificates</strong><br/>
          Click "Generate SSL" on any domain to auto-install a free Let's Encrypt certificate.
        </div>
      </div>

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
        <div className="form-row">
          <div className="form-group">
            <label>DNS Type</label>
            <select className="form-select" value={form.dnsType} onChange={e => setForm({ ...form, dnsType: e.target.value })}>
              <option value="A">A Record</option>
              <option value="CNAME">CNAME</option>
            </select>
          </div>
          <div className="form-group">
            <label>DNS Value / Server IP</label>
            <input className="form-input" value={form.dnsValue} onChange={e => setForm({ ...form, dnsValue: e.target.value })} placeholder="e.g. 123.45.67.89" />
          </div>
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
    </div>
  );
}
