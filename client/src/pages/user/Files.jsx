import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import PersonalizeModal from '../../components/PersonalizeModal';
import { useToast } from '../../components/Toast';

export default function Files() {
  const toast = useToast();
  const [pages, setPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [addMode, setAddMode] = useState('link'); // 'link' | 'file'
  const [addingLink, setAddingLink] = useState(false);
  const [uploadFileObj, setUploadFileObj] = useState(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deployModal, setDeployModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewModal, setPreviewModal] = useState(false);
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [deployment, setDeployment] = useState(null);
  const [storeSaving, setStoreSaving] = useState(false);
  const [personalHtml, setPersonalHtml] = useState(null); // non-null => personalize modal open

  useEffect(() => {
    if (!selectedPage) { setDeployment(null); return; }
    api.getMyDeployment(selectedPage).then(setDeployment).catch(() => setDeployment(null));
  }, [selectedPage]);

  async function openPersonalize() {
    if (!page) return;
    try {
      const r = await api.getPersonalPage(page.id);
      setPersonalHtml(r.html_code);
    } catch (err) { toast(err.message); }
  }

  async function savePersonalize(html) {
    await api.savePersonalPage(page.id, html);
    toast('Your personalized version of "' + page.name + '" is live on all your deployments.');
    setPersonalHtml(null);
    load();
  }

  async function resetPersonalize() {
    if (!page) return;
    if (!confirm('Remove your personalization for "' + page.name + '" and go back to the shared template?')) return;
    try {
      await api.resetPersonalPage(page.id);
      toast('Reverted to the shared template.');
      load();
    } catch (err) { toast(err.message); }
  }

  async function downloadZip() {
    if (!page || downloading) return;
    setDownloading(true);
    try {
      const name = await api.downloadShimZip(page.id);
      toast('Download started: ' + name + ' — check your Downloads folder.');
    } catch (err) { toast(err.message); }
    finally { setDownloading(false); }
  }

  async function rotate() {
    if (!selectedPage) return;
    if (!confirm('Rotate the deployment secret? The currently-deployed index.php will stop working until you upload the new one.')) return;
    try {
      await api.rotatePageShimSecret(selectedPage);
      toast('Secret rotated — re-download index.php and replace it where deployed.');
    } catch (err) { toast(err.message); }
  }

  async function toggleStore() {
    if (!page || !deployment || storeSaving) return;
    const next = deployment.store_enabled === 0;
    setStoreSaving(true);
    try {
      const r = await api.setStoreToggle(page.id, next);
      setDeployment({ ...deployment, store_enabled: r.store_enabled });
      toast(r.store_enabled ? 'App Store ending page ON — visitors go to the store page after download.' : 'App Store ending page OFF — visitors stay on the landing page after download.');
    } catch (err) { toast(err.message); }
    finally { setStoreSaving(false); }
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

  async function handleUploadFile() {
    if (!uploadFileObj) { toast('Select a file first'); return; }
    if (!selectedPage) { toast('No page selected'); return; }
    const fd = new FormData();
    fd.append('file', uploadFileObj);
    fd.append('notes', uploadNotes.trim());
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await api.uploadFile(selectedPage, fd, e => {
        if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
      });
      toast('Uploaded as v' + result.version + ' and activated!');
      setUploadFileObj(null);
      setUploadNotes('');
      setUploadProgress(0);
      load();
    } catch (err) {
      toast(err.message);
    } finally {
      setUploading(false);
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
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
              {page?.has_variant && <span className="badge badge-green">Personalized</span>}
              {deployment && (
                <div
                  title={deployment.store_enabled === 0 ? 'App Store ending page OFF — visitors stay on the landing page after the download.' : 'App Store ending page ON — after the download, visitors are sent to the App Store page.'}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', background: '#0f1117', border: '1px solid #1e2230', borderRadius: 8 }}
                >
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>App Store ending</span>
                  <button
                    onClick={toggleStore}
                    disabled={storeSaving}
                    role="switch"
                    aria-checked={deployment.store_enabled !== 0}
                    aria-label="Toggle Microsoft App Store ending page"
                    style={{ position: 'relative', width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s', background: deployment.store_enabled === 0 ? '#3a3f4b' : '#16a34a', opacity: storeSaving ? 0.6 : 1 }}
                  >
                    <span style={{ position: 'absolute', top: 2, left: deployment.store_enabled === 0 ? 2 : 18, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                  </button>
                </div>
              )}
              <button className="btn btn-outline btn-sm" onClick={openPersonalize}>Personalize</button>
              {page?.has_variant && <button className="btn btn-outline btn-sm" onClick={resetPersonalize}>Reset</button>}
              <button className="btn btn-outline btn-sm" onClick={() => { setPreviewDevice('desktop'); setPreviewModal(true); }}>Preview</button>
              <button className="btn btn-primary btn-sm" onClick={() => setDeployModal(true)}>Deploy to a host</button>
            </div>
          )}
        </div>
      </div>

      <div className="section-card">
        <h3>Add Version</h3>
        <p className="desc">Upload a file directly or add an external download link. It will automatically become the active version.</p>

        <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: '1px solid #1e2230' }}>
          {[['file', 'Upload File'], ['link', 'External Link']].map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setAddMode(mode)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '8px 18px',
                fontSize: '0.85rem', fontWeight: addMode === mode ? 600 : 400,
                color: addMode === mode ? '#60a5fa' : '#94a3b8',
                borderBottom: addMode === mode ? '2px solid #60a5fa' : '2px solid transparent',
                marginBottom: -1,
              }}
            >{label}</button>
          ))}
        </div>

        {addMode === 'file' ? (
          <div>
            <div className="form-group">
              <label>File</label>
              <input
                className="form-input"
                type="file"
                onChange={e => setUploadFileObj(e.target.files[0] || null)}
              />
              {uploadFileObj && (
                <span style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4, display: 'block' }}>
                  {uploadFileObj.name} ({(uploadFileObj.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              )}
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <input
                className="form-input"
                value={uploadNotes}
                onChange={e => setUploadNotes(e.target.value)}
                placeholder="e.g. v2.1.0 release"
              />
            </div>
            {uploading && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }}>
                  <span>Uploading…</span><span>{uploadProgress}%</span>
                </div>
                <div style={{ height: 6, background: '#1e2230', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: uploadProgress + '%', background: '#3b82f6', borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
              </div>
            )}
            <button className="btn btn-primary" onClick={handleUploadFile} disabled={uploading || !uploadFileObj}>
              {uploading ? 'Uploading…' : 'Upload File'}
            </button>
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

            {deployment && (
              <div style={{ marginBottom: 14, padding: 12, background: '#0a1a0e', borderRadius: 8, border: '1px solid #134e1e', fontSize: '0.82rem', lineHeight: 1.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#86efac', fontWeight: 600, marginBottom: 2 }}>This deployment is uniquely yours</div>
                    <div style={{ color: '#94a3b8' }}>Logged in as <strong style={{ color: '#cbd5e1' }}>{deployment.user_name}</strong>. Only YOUR active version will be served from this zip — no other user's content can leak.</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fingerprint</div>
                    <div style={{ color: '#fbbf24', fontFamily: 'Consolas, monospace', fontWeight: 700, fontSize: '1.1rem' }}>{deployment.fingerprint}</div>
                  </div>
                </div>
              </div>
            )}

            {deployment && !deployment.has_active_version && (
              <div style={{ marginBottom: 14, padding: 12, background: '#1a1206', borderRadius: 8, border: '1px solid #3a2406', color: '#fbbf24', fontSize: '0.82rem', lineHeight: 1.6 }}>
                <strong>⚠ You have no active version for this page.</strong> If you deploy this zip now, visitors will see the page but the download will fail. Add a link in the "Add Version" form above before deploying.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={downloadZip} disabled={downloading}>
                {downloading ? 'Downloading…' : 'Download deployment (.zip)'}
              </button>
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

      {personalHtml !== null && page && (
        <PersonalizeModal
          title={'Personalize: ' + page.name}
          initialHtml={personalHtml}
          onClose={() => setPersonalHtml(null)}
          onSave={savePersonalize}
        />
      )}

      <Modal
        title={page ? 'Preview: ' + page.name : 'Preview'}
        show={previewModal}
        onClose={() => setPreviewModal(false)}
        footer={<>
          <div style={{ display: 'flex', gap: 8, marginRight: 'auto' }}>
            <button className={'btn btn-sm ' + (previewDevice === 'desktop' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('desktop')}>Desktop</button>
            <button className={'btn btn-sm ' + (previewDevice === 'tablet' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('tablet')}>Tablet</button>
            <button className={'btn btn-sm ' + (previewDevice === 'mobile' ? 'btn-primary' : 'btn-outline')} onClick={() => setPreviewDevice('mobile')}>Mobile</button>
          </div>
          {page && <a className="btn btn-outline btn-sm" href={'/page/' + page.id} target="_blank" rel="noopener">Open in new tab</a>}
          <button className="btn btn-primary" onClick={() => setPreviewModal(false)}>Close</button>
        </>}
      >
        {page && (
          <div style={{ background: '#0f1117', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'center' }}>
            <iframe
              key={page.id + previewDevice}
              src={'/page/' + page.id + '?_t=' + Date.now()}
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
          This is the exact HTML visitors see after passing antibot. Bot challenge and Windows-only gate are skipped for in-dashboard previews.
        </p>
      </Modal>
    </div>
  );
}
