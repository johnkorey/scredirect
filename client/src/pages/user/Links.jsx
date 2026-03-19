import React, { useEffect, useState } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';

export default function Links() {
  const toast = useToast();
  const [links, setLinks] = useState([]);

  function load() {
    api.getLinks().then(setLinks).catch(() => {});
  }
  useEffect(load, []);

  const ready = links.filter(l => l.status === 'ready').length;
  const httpOnly = links.filter(l => l.status === 'http_only').length;
  const pending = links.filter(l => l.status === 'no_page').length;

  function copyLink(url) {
    navigator.clipboard.writeText(url).then(() => {
      toast('Link copied to clipboard!');
    }).catch(() => {
      toast('Failed to copy');
    });
  }

  function statusBadge(status) {
    if (status === 'ready') return <span className="badge badge-green">Ready (HTTPS)</span>;
    if (status === 'http_only') return <span className="badge badge-yellow">HTTP Only</span>;
    if (status === 'no_page') return <span className="badge badge-red">No Page Assigned</span>;
    return <span className="badge badge-gray">Unknown</span>;
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>My Links</h1><p>Generated links for your domains. Share these with visitors.</p></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></div>
          <div><div className="stat-value">{links.length}</div><div className="stat-label">Total Links</div></div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg></div>
          <div><div className="stat-value">{ready}</div><div className="stat-label">Ready (HTTPS)</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></div>
          <div><div className="stat-value">{httpOnly + pending}</div><div className="stat-label">Pending Setup</div></div>
        </div>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {links.length === 0 ? (
          <div className="empty-state">
            <p>No links yet. Add domains and assign them to landing pages first.</p>
            <a className="btn btn-primary" href="/user/domains">Go to Domains</a>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Domain</th><th>Landing Page</th><th>Your Link</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {links.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600, color: '#60a5fa' }}>{l.domain}</td>
                  <td>{l.page_name || <span style={{ color: '#475569' }}>Not assigned</span>}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ background: 'rgba(129,140,248,0.1)', color: '#818cf8', padding: '4px 10px', borderRadius: 6, fontSize: '0.82rem' }}>
                        {l.link}
                      </code>
                      <button className="btn btn-outline btn-sm" onClick={() => copyLink(l.link)} title="Copy link">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                        Copy
                      </button>
                    </div>
                  </td>
                  <td>{statusBadge(l.status)}</td>
                  <td>
                    <div className="btn-row">
                      <a className="btn btn-outline btn-sm" href={l.link} target="_blank" rel="noopener">Preview</a>
                      <button className="btn btn-outline btn-sm" onClick={() => copyLink(l.link)}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                        Copy Link
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-card" style={{ marginTop: 20 }}>
        <h3>How Links Work</h3>
        <p className="desc">Your links route visitors through your custom domain to the assigned landing page.</p>
        <div style={{ padding: 14, background: '#0f1117', borderRadius: 8, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.8 }}>
          <strong style={{ color: '#f1f5f9' }}>1. Add a Domain</strong><br/>
          Go to <a href="/user/domains" style={{ color: '#818cf8' }}>My Domains</a> and add your custom domain.<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>2. Assign a Landing Page</strong><br/>
          Link the domain to a landing page in the domain settings.<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>3. Configure DNS & Verify</strong><br/>
          Set up the A record shown in the DNS guide, then click "Verify DNS" to confirm propagation.<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>4. Share Your Link</strong><br/>
          Copy your custom domain link and share it. Visitors will see the landing page and get redirected to the download (file or external link).<br/><br/>
          <strong style={{ color: '#f1f5f9' }}>Note:</strong> Non-Windows visitors will see a message that the software is for Windows only.
        </div>
      </div>
    </div>
  );
}
