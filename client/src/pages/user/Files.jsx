import React, { useEffect, useState, useRef } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
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
  const [deployModal, setDeployModal] = useState(false);

  async function rotate() {
    if (!selectedPage) return;
    if (!confirm('Rotate the deployment secret? The currently-deployed index.php will stop working until you upload the new one.')) return;
    try {
      await api.rotatePageShimSecret(selectedPage);
      toast('Secret rotated — re-download index.php and replace it where deployed.');
    } catch (err) { toast(err.message); }
  }

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
          {selectedPage && (
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDeployModal(true)}>Deploy to a host</button>
          )}
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

      <Modal
        title={page ? 'Deploy "' + page.name + '"' : 'Deploy'}
        show={deployModal}
        onClose={() => setDeployModal(false)}
        footer={<button className="btn btn-primary" onClick={() => setDeployModal(false)}>Done</button>}
      >
        {page && (
          <div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 14 }}>
              Drop the two files below into the document root of any host (cPanel domain, subdomain, or a server reachable by IP). No DNS setup on this side is required.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={api.shimZipUrl(page.id)} download>Download deployment (.zip)</a>
            </div>
            <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, border: '1px solid #1e2230', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.7 }}>
              <strong style={{ color: '#f1f5f9' }}>Setup</strong>
              <ol style={{ paddingLeft: 20, marginTop: 6 }}>
                <li>Open the document root of the host that should serve this page (e.g. <code>public_html</code> on cPanel).</li>
                <li>Extract the zip. You'll get <code>index.php</code> and <code>.htaccess</code>; upload both. If <code>.htaccess</code> already exists, merge the rewrite rules.</li>
                <li>Ensure <strong>mod_rewrite</strong> and the <strong>cURL</strong> PHP extension are enabled.</li>
                <li>Visit the host. The antibot pipeline runs here; the visitor only sees the host's URL.</li>
              </ol>
            </div>
            <div style={{ marginTop: 14, padding: 12, background: '#1a1206', borderRadius: 8, border: '1px solid #3a2406', color: '#fbbf24', fontSize: '0.78rem' }}>
              <strong>Security:</strong> the downloaded <code>index.php</code> contains a secret unique to this landing page. Don't share it. If it leaks, rotate below.
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" onClick={rotate}>Rotate Secret</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
