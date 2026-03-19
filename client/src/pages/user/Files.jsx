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
  const [tab, setTab] = useState('file');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [addingLink, setAddingLink] = useState(false);

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

  async function handleAddLink() {
    if (!linkUrl.trim()) { toast('Please enter a URL'); return; }
    if (!selectedPage) { toast('No page selected'); return; }

    setAddingLink(true);
    setUploadMsg('Adding link...');
    try {
      const result = await api.addLink(selectedPage, { linkUrl: linkUrl.trim(), notes: linkNotes.trim() });
      setUploadMsg('Link added as v' + result.version + ' and activated!');
      toast('Link added & activated as v' + result.version);
      setLinkUrl('');
      setLinkNotes('');
      load();
    } catch (err) {
      setUploadMsg('Error: ' + err.message);
      toast(err.message);
    } finally {
      setAddingLink(false);
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
        <h3>Add Version</h3>
        <p className="desc">Upload a file or add an external link. It will automatically become the active version.</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            className={'btn btn-sm' + (tab === 'file' ? '' : ' btn-outline')}
            style={tab === 'file' ? { background: '#818cf8', color: '#fff' } : {}}
            onClick={() => setTab('file')}
          >
            Upload File
          </button>
          <button
            className={'btn btn-sm' + (tab === 'link' ? '' : ' btn-outline')}
            style={tab === 'link' ? { background: '#818cf8', color: '#fff' } : {}}
            onClick={() => setTab('link')}
          >
            External Link
          </button>
        </div>

        {tab === 'file' ? (
          <div className="upload-area" onClick={() => fileRef.current?.click()}>
            <input type="file" ref={fileRef} onChange={handleUpload} />
            <div className="upload-icon">&#8682;</div>
            <p>{uploading ? 'Uploading...' : 'Click to select a file'}</p>
          </div>
        ) : (
          <div>
            <div className="form-group">
              <label>External URL</label>
              <input
                className="form-input"
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://example.com/download/app.exe"
              />
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <input
                className="form-input"
                value={linkNotes}
                onChange={e => setLinkNotes(e.target.value)}
                placeholder="e.g. Google Drive download link"
              />
            </div>
            <button className="btn btn-primary" onClick={handleAddLink} disabled={addingLink}>
              {addingLink ? 'Adding...' : 'Add Link'}
            </button>
          </div>
        )}

        {uploadMsg && (
          <div style={{ padding: 12, background: '#0f1117', borderRadius: 8, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', flexShrink: 0 }}></span>
            <span style={{ fontSize: '0.85rem' }}>{uploadMsg}</span>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3>Version History</h3>
        <p className="desc">All versions for this page.</p>
        {versions.length === 0 ? (
          <div className="empty-state"><p>No versions yet. Upload a file or add a link above.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Source</th><th>Type</th><th>Version</th><th>Date</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {versions.map(v => {
                const isLink = !!v.link_url;
                return (
                  <tr key={v.id}>
                    <td style={{ maxWidth: 220 }}>
                      {isLink ? (
                        <span style={{ color: '#60a5fa', wordBreak: 'break-all', fontSize: '0.82rem' }}>{v.link_url}</span>
                      ) : (
                        <span style={{ fontWeight: 500, color: '#f1f5f9' }}>{v.original_name || v.file_name}</span>
                      )}
                    </td>
                    <td>
                      <span className={'badge ' + (isLink ? 'badge-blue' : 'badge-gray')}>
                        {isLink ? 'Link' : 'File'}
                      </span>
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
