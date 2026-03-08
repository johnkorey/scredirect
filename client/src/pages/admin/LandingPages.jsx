import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

export default function LandingPages() {
  const toast = useToast();
  const [pages, setPages] = useState([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', htmlCode: '', status: 'active' });

  function load() {
    api.getPages().then(setPages).catch(() => {});
  }
  useEffect(load, []);

  function openNew() {
    setEditId(null);
    setForm({ name: '', htmlCode: '', status: 'active' });
    setModal(true);
  }

  function openEdit(p) {
    setEditId(p.id);
    setForm({ name: p.name, htmlCode: p.html_code || '', status: p.status });
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
                </div>
                <div className="btn-row">
                  <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>Edit</button>
                  <a className="btn btn-outline btn-sm" href={'/page/' + p.id} target="_blank" rel="noopener">Preview</a>
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
        <div className="form-group">
          <label>Status</label>
          <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
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
        <div className="placeholder-hint">
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 8 }}>Available placeholders:</p>
          <code>{'{{download_url}}'}</code> — Auto-download link<br/>
          <code>{'{{file_name}}'}</code> — Uploaded file name<br/>
          <code>{'{{version}}'}</code> — Current version<br/>
          <code>{'{{app_name}}'}</code> — Page name
        </div>
      </Modal>
    </div>
  );
}
