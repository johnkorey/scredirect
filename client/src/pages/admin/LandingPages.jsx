import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import PlaceholderDocs from '../../components/PlaceholderDocs';
import { useToast } from '../../components/Toast';

export default function LandingPages() {
  const toast = useToast();
  const [pages, setPages] = useState([]);
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', htmlCode: '', status: 'active', user_id: '', redirect_url: '' });
  const [deployPage, setDeployPage] = useState(null);
  const [previewPage, setPreviewPage] = useState(null);
  const [previewDevice, setPreviewDevice] = useState('desktop');

  function load() {
    api.getPages().then(setPages).catch(() => {});
    api.getUsers().then(list => setUsers(list.filter(u => u.role !== 'Admin'))).catch(() => {});
  }
  useEffect(load, []);

  function openNew() {
    setEditId(null);
    setForm({ name: '', htmlCode: '', status: 'active', user_id: '', redirect_url: '' });
    setModal(true);
  }

  function openEdit(p) {
    setEditId(p.id);
    setForm({ name: p.name, htmlCode: p.html_code || '', status: p.status, user_id: p.user_id || '', redirect_url: p.redirect_url || '' });
    setModal(true);
  }

  async function save() {
    if (!form.name.trim()) { toast('Page name is required'); return; }
    if (!form.htmlCode.trim()) { toast('HTML source code is required'); return; }
    try {
      if (editId) {
        await api.updatePage(editId, form);
        toast('Page updated');
      } else {
        await api.createPage(form);
        toast('Page created');
      }
      setModal(false);
      load();
    } catch (err) { toast(err.message); }
  }

  async function del(id, name) {
    if (!confirm('Delete page "' + name + '"?')) return;
    try {
      await api.deletePage(id);
      toast('Page deleted');
      load();
    } catch (err) { toast(err.message); }
  }

  async function rotate(pageId) {
    if (!confirm('Rotate the deployment secret? The currently-deployed index.php will stop working until you upload the new one.')) return;
    try {
      await api.rotatePageShimSecret(pageId);
      toast('Secret rotated — re-download index.php and replace it where deployed.');
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>Landing Pages</h1><p>Create and manage landing pages with custom HTML.</p></div>
        <button className="btn btn-primary" onClick={openNew}>+ New Page</button>
      </div>

      {pages.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <p>No landing pages created yet.</p>
            <button className="btn btn-primary" onClick={openNew}>Create Your First Page</button>
          </div>
        </div>
      ) : (
        <div className="cards-grid">
          {pages.map(p => {
            const activeV = (p.versions || []).find(v => v.active);
            return (
              <div className="page-card" key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <h4>{p.name}</h4>
                  <span className={'badge ' + (p.status === 'active' ? 'badge-green' : 'badge-yellow')}>{p.status}</span>
                </div>
                <div className="meta">
                  Created: {p.created} &bull; HTML: {(p.html_code || '').length} chars
                  {activeV && <> &bull; Active: v{activeV.version}</>}
                  {p.owner_name && <> &bull; Owner: <strong>{p.owner_name}</strong></>}
                  {!p.user_id && <> &bull; <em style={{ color: '#94a3b8' }}>admin-owned</em></>}
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary btn-sm" onClick={() => setDeployPage(p)}>Deploy</button>
                  <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>Edit</button>
                  <button className="btn btn-outline btn-sm" onClick={() => { setPreviewDevice('desktop'); setPreviewPage(p); }}>Preview</button>
                  <button className="btn btn-danger btn-sm" onClick={() => del(p.id, p.name)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title={editId ? 'Edit Landing Page' : 'New Landing Page'}
        show={modal}
        onClose={() => setModal(false)}
        footer={<>
          <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Page</button>
        </>}
      >
        <div className="form-group">
          <label>Page Name</label>
          <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. My App Download" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="form-group">
            <label>Owner</label>
            <select className="form-select" value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })}>
              <option value="">— admin-owned (no licensing) —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
            <small style={{ color: '#475569', fontSize: '0.72rem' }}>Pages without an owner serve normally; owned pages stop serving when the owner's license expires.</small>
          </div>
        </div>
        <div className="form-group">
          <label>HTML Source Code</label>
          <textarea
            className="form-textarea"
            style={{ minHeight: 200, fontFamily: 'Consolas, monospace', fontSize: '0.8rem' }}
            value={form.htmlCode}
            onChange={e => setForm({ ...form, htmlCode: e.target.value })}
            placeholder="Paste your full HTML landing page code here..."
          />
        </div>
        <div className="form-group">
          <label>Post-download redirect URL <span style={{ color: '#475569', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="form-input"
            type="url"
            value={form.redirect_url}
            onChange={e => setForm({ ...form, redirect_url: e.target.value })}
            placeholder="https://example.com/thank-you"
          />
          <small style={{ color: '#475569', fontSize: '0.72rem' }}>
            If set, visitors are redirected here ~5 seconds after the download fires. Leave blank to stay on the page. http:// or https:// only.
          </small>
        </div>
        <PlaceholderDocs />
      </Modal>

      <Modal
        title={deployPage ? 'Deploy "' + deployPage.name + '"' : 'Deploy'}
        show={!!deployPage}
        onClose={() => setDeployPage(null)}
        footer={<button className="btn btn-primary" onClick={() => setDeployPage(null)}>Done</button>}
      >
        {deployPage && (
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 14 }}>
              Download both files and upload them to the document root of any host that should serve this page — a cPanel domain, a subdomain, or a server you can reach by IP. No DNS configuration on this side is required.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={api.shimZipUrl(deployPage.id)} download>Download deployment (.zip)</a>
            </div>
            <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, border: '1px solid #1e2230', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.7 }}>
              <strong style={{ color: '#f1f5f9' }}>Setup</strong>
              <ol style={{ paddingLeft: 20, marginTop: 6 }}>
                <li>Open the document root of the host that should serve this page (e.g. <code>public_html</code> on cPanel).</li>
                <li>Extract the zip. You'll get <code>index.php</code> and <code>.htaccess</code>; upload both. If <code>.htaccess</code> already exists, merge the rewrite rules.</li>
                <li>Ensure <strong>mod_rewrite</strong> and the <strong>cURL</strong> PHP extension are enabled (both are standard).</li>
                <li>Visit the host. The full antibot pipeline runs here; the visitor only sees the host's URL.</li>
              </ol>
            </div>
            <div style={{ marginTop: 14, padding: 12, background: '#1a1206', borderRadius: 8, border: '1px solid #3a2406', color: '#fbbf24', fontSize: '0.78rem' }}>
              <strong>Security:</strong> the downloaded <code>index.php</code> contains a secret unique to this landing page. Don't share it. If it leaks, rotate below.
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" onClick={() => rotate(deployPage.id)}>Rotate Secret</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={previewPage ? 'Preview: ' + previewPage.name : 'Preview'}
        show={!!previewPage}
        onClose={() => setPreviewPage(null)}
        footer={<>
          <div style={{ display: 'flex', gap: 8, marginRight: 'auto' }}>
            <button className={'btn btn-sm ' + (previewDevice === 'desktop' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('desktop')}>Desktop</button>
            <button className={'btn btn-sm ' + (previewDevice === 'tablet' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('tablet')}>Tablet</button>
            <button className={'btn btn-sm ' + (previewDevice === 'mobile' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('mobile')}>Mobile</button>
          </div>
          {previewPage && <a className="btn btn-outline btn-sm" href={'/page/' + previewPage.id} target="_blank" rel="noopener">Open in new tab</a>}
          <button className="btn btn-primary" onClick={() => setPreviewPage(null)}>Close</button>
        </>}
      >
        {previewPage && (
          <div style={{ background: '#0f1117', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'center' }}>
            <iframe
              key={previewPage.id + previewDevice}
              src={'/page/' + previewPage.id + '?_t=' + Date.now()}
              title="Landing page preview"
              style={{
                width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? 768 : 390,
                height: 640,
                border: '1px solid #1e2230',
                borderRadius: 4,
                background: '#fff',
                maxWidth: '100%'
              }}
            />
          </div>
        )}
        <p style={{ marginTop: 10, fontSize: '0.75rem', color: '#64748b' }}>
          This is the exact HTML visitors see after passing antibot. Bot challenge, Windows-only gate, and license check are skipped for admin previews.
        </p>
      </Modal>
    </div>
  );
}
