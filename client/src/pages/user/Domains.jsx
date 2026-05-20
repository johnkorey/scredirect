import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

export default function Domains() {
  const toast = useToast();
  const [domains, setDomains] = useState([]);
  const [pages, setPages] = useState([]);
  const [modal, setModal] = useState(false);
  const [deployModal, setDeployModal] = useState(false);
  const [deployDomain, setDeployDomain] = useState(null);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ domain: '', pageId: '', notes: '' });

  function load() {
    api.getDomains().then(setDomains).catch(() => {});
    api.getPages().then(setPages).catch(() => {});
  }
  useEffect(load, []);

  function openNew() {
    setEditId(null);
    setForm({ domain: '', pageId: '', notes: '' });
    setModal(true);
  }

  function openEdit(d) {
    setEditId(d.id);
    setForm({ domain: d.domain, pageId: d.page_id || '', notes: d.notes || '' });
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
        const created = await api.createDomain(form);
        toast('Domain added');
        setModal(false);
        load();
        openDeploy(created);
        return;
      }
      load();
    } catch (err) { toast(err.message); }
  }

  async function del(id) {
    if (!confirm('Delete this domain? The shim files on your cPanel will stop working.')) return;
    try { await api.deleteDomain(id); toast('Domain deleted'); load(); }
    catch (err) { toast(err.message); }
  }

  function openDeploy(d) {
    setDeployDomain(d);
    setDeployModal(true);
  }

  async function rotate(id) {
    if (!confirm('Rotate the shim secret? The currently-deployed index.php will stop working until you upload the new one.')) return;
    try {
      await api.rotateShimSecret(id);
      toast('Secret rotated — re-download index.php and replace it on your cPanel.');
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>My Domains</h1><p>Each domain is served from your own cPanel hosting via a small PHP file that talks to this server.</p></div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Domain</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg></div>
          <div><div className="stat-value">{domains.length}</div><div className="stat-label">Total Domains</div></div>
        </div>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {domains.length === 0 ? (
          <div className="empty-state"><p>No domains added yet.</p><button className="btn btn-primary" onClick={openNew}>Add Your First Domain</button></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Domain</th><th>Landing Page</th><th>Added</th><th>Actions</th></tr></thead>
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
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{d.created}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn-primary btn-sm" onClick={() => openDeploy(d)}>Deployment Files</button>
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
        <h3>How deployment works</h3>
        <ol style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Add your domain above and assign it to a landing page.</li>
          <li>Click <strong>Deployment Files</strong> to download <code>index.php</code> and <code>.htaccess</code>.</li>
          <li>Upload both files to your domain's <code>public_html</code> on cPanel.</li>
          <li>Visit your domain — the antibot pipeline runs on this server while your visitors only see your domain.</li>
        </ol>
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
        <div className="form-group">
          <label>Notes (optional)</label>
          <input className="form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Main download domain" />
        </div>
      </Modal>

      <Modal
        title={deployDomain ? 'Deploy to ' + deployDomain.domain : 'Deployment Files'}
        show={deployModal}
        onClose={() => setDeployModal(false)}
        footer={<button className="btn btn-primary" onClick={() => setDeployModal(false)}>Done</button>}
      >
        {deployDomain && (
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 14 }}>
              Download both files and upload them to <code>public_html</code> on the cPanel account that serves <code>{deployDomain.domain}</code>.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <a className="btn btn-primary" href={api.shimPackageUrl(deployDomain.id)} download>Download index.php</a>
              <a className="btn btn-outline" href={api.shimHtaccessUrl(deployDomain.id)} download>Download .htaccess</a>
            </div>
            <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, border: '1px solid #1e2230', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.7 }}>
              <strong style={{ color: '#f1f5f9' }}>Setup steps</strong>
              <ol style={{ paddingLeft: 20, marginTop: 6 }}>
                <li>Make sure your domain points to your cPanel hosting (an A record at your registrar — your hosting provider tells you which IP).</li>
                <li>In cPanel File Manager, open <code>public_html</code> for this domain.</li>
                <li>Upload <code>index.php</code> and <code>.htaccess</code>. If <code>.htaccess</code> already exists, merge the rewrite rules.</li>
                <li>Ensure <strong>mod_rewrite</strong> and the <strong>cURL</strong> PHP extension are enabled (both are standard on cPanel).</li>
                <li>Visit your domain — you should see your landing page within a couple of seconds.</li>
              </ol>
            </div>
            <div style={{ marginTop: 14, padding: 12, background: '#1a1206', borderRadius: 8, border: '1px solid #3a2406', color: '#fbbf24', fontSize: '0.78rem' }}>
              <strong>Security:</strong> the downloaded <code>index.php</code> contains a secret unique to this domain. Don't share it. If it leaks, rotate below.
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" onClick={() => rotate(deployDomain.id)}>Rotate Secret</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
