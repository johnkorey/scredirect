import React, { useState } from 'react';

const PLACEHOLDERS = [
  { tag: '{{download_url}}',        what: 'URL the visitor should hit to download. Use it in an href or with the helper script.' },
  { tag: '{{file_name}}',           what: 'Original filename of the active version (for links: the page name).' },
  { tag: '{{file_size}}',           what: 'Human-readable size of the active file (e.g. "12.4 MB"). Empty for external links.' },
  { tag: '{{version}}',             what: 'Version label of the active version (e.g. "0.0.3").' },
  { tag: '{{release_date}}',        what: 'Date the active version was uploaded (YYYY-MM-DD).' },
  { tag: '{{app_name}}',            what: 'Landing page name set in this modal.' },
  { tag: '{{year}}',                what: 'Current year — handy for footers.' },
  { tag: '{{is_link}}',             what: '"true" or "false" — for templates that branch on link vs file.' },
  { tag: '{{download_button}}',     what: 'Drop-in styled button. One token, full HTML <a> with icon + filename + size.' },
  { tag: '{{download_link}}',       what: 'Plain <a> link wrapping the filename. Style it yourself.' },
  { tag: '{{auto_download_script}}',what: 'Script that auto-triggers the download 2s after page load. Drop it once.' },
  { tag: '{{redirect_url}}',        what: 'The post-download redirect URL set on the page (or empty). The actual redirect is auto-wired — this is just for templates that want to display it.' },
  { tag: '{{post_download_url}}',   what: 'Relative URL of the branded post-download store page picked in the "Post-download page" dropdown (e.g. /store/zoom-workplace). Empty when none is selected. The redirect is auto-wired — use this only if your template redirects itself.' },
];

const SNIPPETS = [
  {
    title: 'Minimal page — auto-download + status',
    code: `<!doctype html>
<html><head><meta charset="utf-8"><title>Downloading {{app_name}}</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px 20px;">
  <h1>{{app_name}} v{{version}}</h1>
  <p id="status">Starting download of {{file_name}} ({{file_size}})...</p>
  {{download_button}}
  {{auto_download_script}}
  <footer style="margin-top:60px;color:#888;font-size:.8rem;">© {{year}} {{app_name}}</footer>
</body></html>`
  },
  {
    title: 'Manual button only — no auto-trigger',
    code: `<h2>{{app_name}} — version {{version}}</h2>
<p>Released {{release_date}}{{file_size}}</p>
{{download_button}}`
  },
  {
    title: 'Custom button using window.__scDownload()',
    code: `<button onclick="window.__scDownload()" id="dl">
  Download {{file_name}}{{file_size}}
</button>
<p id="status">Click the button to start.</p>`
  },
];

const HELPERS = [
  { id: 'window.__scDownload()',     desc: 'JS function injected on every render. Call it from your own buttons to trigger the download.' },
  { id: '#status / #sc-dl-status',   desc: 'If you give an element either of these ids, the helper updates its text to "Download completed! ✅" after the download fires.' },
  { id: '#progress',                 desc: 'A <div id="progress"> bar gets its width set to 100% and turns green on completion.' },
  { id: '.manual',                   desc: 'Any element with class="manual" has its innerHTML replaced with a green "Download completed" message after the download fires.' },
  { id: '#hp_website',               desc: 'Honeypot input the antibot challenge uses. Don\'t override this id.' },
];

function Snippet({ title, code }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <strong style={{ fontSize: '0.8rem', color: '#f1f5f9' }}>{title}</strong>
        <button type="button" className="btn btn-outline btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre style={{ background: '#0f1117', color: '#e2e8f0', padding: 10, borderRadius: 6, border: '1px solid #1e2230', fontSize: '0.74rem', overflow: 'auto', maxHeight: 220, lineHeight: 1.5 }}>{code}</pre>
    </div>
  );
}

export default function PlaceholderDocs() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16, border: '1px solid #1e2230', borderRadius: 8, background: '#0f1117' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ width: '100%', background: 'transparent', border: 'none', color: '#f1f5f9', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
      >
        <span>Placeholder reference {open ? '— click to collapse' : '— click to expand'}</span>
        <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 8 }}>
            Any of these tokens appearing in your HTML are replaced by the server when a visitor loads the page (or when you click <strong>Preview</strong>). The active file/link version drives all of them.
          </p>

          <table style={{ width: '100%', fontSize: '0.78rem', marginBottom: 16, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2230' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#94a3b8', fontWeight: 600 }}>Token</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#94a3b8', fontWeight: 600 }}>What it becomes</th>
              </tr>
            </thead>
            <tbody>
              {PLACEHOLDERS.map(p => (
                <tr key={p.tag} style={{ borderBottom: '1px solid #1a1d27' }}>
                  <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                    <code style={{ background: '#1e2230', padding: '2px 6px', borderRadius: 4, color: '#fbbf24', fontSize: '0.74rem' }}>{p.tag}</code>
                  </td>
                  <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>{p.what}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ color: '#f1f5f9', fontSize: '0.85rem', marginBottom: 8, marginTop: 8 }}>Copy-paste templates</h4>
          {SNIPPETS.map(s => <Snippet key={s.title} {...s} />)}

          <h4 style={{ color: '#f1f5f9', fontSize: '0.85rem', marginBottom: 8, marginTop: 8 }}>Auto-injected helpers</h4>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: 8 }}>
            A small <code>&lt;script&gt;</code> is automatically appended right before <code>&lt;/body&gt;</code> when an active version exists. It gives you:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.7 }}>
            {HELPERS.map(h => (
              <li key={h.id}><code style={{ background: '#1e2230', padding: '1px 5px', borderRadius: 3, color: '#fbbf24', fontSize: '0.74rem' }}>{h.id}</code> — {h.desc}</li>
            ))}
          </ul>

          <div style={{ marginTop: 12, padding: 10, background: '#0a1a0e', border: '1px solid #134e1e', borderRadius: 6, color: '#86efac', fontSize: '0.74rem', lineHeight: 1.5 }}>
            <strong>Fallback:</strong> If your template doesn't include any download token, a floating "Your download is ready" bar is added at the bottom and the download auto-fires 2s after load. Skip that bar by adding any one of <code>{'{{download_url}}'}</code>, <code>{'{{download_button}}'}</code>, <code>{'{{download_link}}'}</code>, or <code>{'{{auto_download_script}}'}</code>.
          </div>

          <div style={{ marginTop: 10, padding: 10, background: '#1a1206', border: '1px solid #3a2406', borderRadius: 6, color: '#fbbf24', fontSize: '0.74rem', lineHeight: 1.5 }}>
            <strong>Per-user isolation:</strong> The active version is per-(page, user). When User A previews / a visitor hits User A's shim deployment, only User A's active file/link is served — not anyone else's.
          </div>

          <div style={{ marginTop: 10, padding: 10, background: '#0a1422', border: '1px solid #1e3a5f', borderRadius: 6, color: '#93c5fd', fontSize: '0.74rem', lineHeight: 1.5 }}>
            <strong>Post-download redirect:</strong> If you set a <strong>Post-download redirect URL</strong> or pick a <strong>Post-download page</strong> (brand store page) on the page (fields above), visitors are sent there ~5 seconds after the download fires — whether triggered automatically, by <code>{'{{download_button}}'}</code>, by the floating-bar fallback, or by a custom button calling <code>window.__scDownload()</code>. The redirect only fires once per page load.
          </div>
        </div>
      )}
    </div>
  );
}
