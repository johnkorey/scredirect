import React, { useEffect, useState, useRef } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';

export default function Files() {
  const toast = useToast();
  const fileRef = useRef();
  const [pages, setPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  function load() {
    api.getPages().then(p => {
      setPages(p);
      if (!selectedPage && p.length > 0) setSelectedPage(p[0].id);
    }).catch(() => {});
  }
  useEffect(load, []);

  const page = pages.find(p => p.id === selectedPage);
  const versions = page?.versions || [];
  const activeV = versions.find(v => v.active);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !selectedPage) return;

    setUploading(true);
    setUploadMsg('Uploading "' + file.name + '"...');
    try {
      const result = await api.uploadFile(selectedPage, file);
      setUploadMsg('"' + file.name + '" uploaded as v' + result.version + ' and activated!');
      toast('File uploaded & activated as v' + result.version);
      load();
    } catch (err) {
      setUploadMsg('Error: ' + err.message);
      toast(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function activate(vId) {
    try {
      await api.activateVersion(vId);
      toast('Version activated');
      load();
    } catch (err) { toast(err.message); }
  }

  async function deleteVer(vId) {
    if (!confirm('Delete this version?')) return;
    try {
      await api.deleteVersion(vId);
      toast('Version deleted');
      load();
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="page-header"><div><h1>My Files</h1><p>Upload and manage download files for your landing pages.</p></div></div>

      <div className="section-card" style={{ padding: '14px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Select page:</label>
          <select className="form-select" style={{ width: 'auto' }} value={selectedPage} onChange={e => setSelectedPage(e.target.value)}>
            {pages.map(p => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
          </select>
          <span className="badge badge-green">{activeV ? 'Active: v' + activeV.version : 'No active version'}</span>
        </div>
      </div>

      <div className="section-card">
        <h3>Upload File</h3>
        <p className="desc">Select a file to upload. It will automatically become the active download.</p>
        <div className="upload-area" onClick={() => fileRef.current?.click()}>
          <input type="file" ref={fileRef} onChange={handleUpload} />
          <div className="upload-icon">&#8682;</div>
          <p>{uploading ? 'Uploading...' : 'Click to select a file'}</p>
        </div>
        {uploadMsg && (
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 8, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', flexShrink: 0 }}></span>
            <span style={{ fontSize: '0.85rem' }}>{uploadMsg}</span>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3>Version History</h3>
        <p className="desc">All uploaded versions for this page.</p>
        {versions.length === 0 ? (
          <div className="empty-state"><p>No versions yet. Upload a file above.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>File</th><th>Version</th><th>Date</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {versions.map(v => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 500, color: '#f1f5f9' }}>
                    {v.original_name || v.file_name}
                  </td>
                  <td>v{v.version}</td>
                  <td style={{ color: '#64748b' }}>{v.date}</td>
                  <td style={{ maxWidth: 180, fontSize: '0.8rem', color: '#94a3b8' }}>{v.notes}</td>
                  <td><span className={'badge ' + (v.active ? 'badge-green' : 'badge-gray')}>{v.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="btn-row">
                      {!v.active && <button className="btn btn-outline btn-sm" onClick={() => activate(v.id)}>Activate</button>}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteVer(v.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
