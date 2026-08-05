import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../AuthContext';
import { useToast } from '../../components/Toast';
import PersonalizeModal from '../../components/PersonalizeModal';

function TelegramCard() {
  const toast = useToast();
  const [tg, setTg] = useState({ chat_id: '', bot_token_masked: '', configured: false });
  const [draftToken, setDraftToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  function reload() {
    api.getMyTelegram().then(t => {
      setTg(t);
      setChatId(t.chat_id || '');
      setDraftToken('');
    }).catch(() => {});
  }
  useEffect(reload, []);

  async function save(thenTest) {
    setBusy(true);
    try {
      const body = { chat_id: chatId };
      if (draftToken) body.bot_token = draftToken;
      await api.updateMyTelegram(body);
      if (thenTest) {
        await api.testMyTelegram();
        toast('Test sent — check Telegram.');
      } else {
        toast('Telegram saved.');
      }
      reload();
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect Telegram? You will stop receiving download alerts.')) return;
    setBusy(true);
    try {
      await api.updateMyTelegram({ bot_token: '', chat_id: '' });
      toast('Telegram disconnected.');
      reload();
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="section-card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Telegram download alerts</h3>
        <span className={'badge ' + (tg.configured ? 'badge-green' : 'badge-gray')}>{tg.configured ? 'Connected' : 'Not configured'}</span>
      </div>
      <p className="desc" style={{ marginTop: 0 }}>
        Get a Telegram message every time someone downloads from one of your landing pages. Only your pages — not other users'.
      </p>

      <div className="form-row">
        <div className="form-group">
          <label>Bot Token</label>
          <input
            className="form-input"
            type="password"
            value={draftToken}
            onChange={e => setDraftToken(e.target.value)}
            placeholder={tg.bot_token_masked ? 'Current: ' + tg.bot_token_masked + ' (leave blank to keep)' : '123456789:AAH…'}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label>Chat ID</label>
          <input
            className="form-input"
            value={chatId}
            onChange={e => setChatId(e.target.value)}
            placeholder="e.g. 123456789"
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>Save</button>
        <button className="btn btn-outline" onClick={() => save(true)} disabled={busy}>Save & Send Test</button>
        {tg.configured && <button className="btn btn-danger" onClick={disconnect} disabled={busy}>Disconnect</button>}
        <button className="btn btn-outline" type="button" onClick={() => setShowHelp(s => !s)} style={{ marginLeft: 'auto' }}>
          {showHelp ? 'Hide setup help' : 'How do I get these?'}
        </button>
      </div>

      {showHelp && (
        <div style={{ marginTop: 12, padding: 12, background: '#0f1117', borderRadius: 8, border: '1px solid #1e2230', color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.7 }}>
          <strong style={{ color: '#f1f5f9' }}>One-time setup (2 minutes)</strong>
          <ol style={{ paddingLeft: 20, marginTop: 6, marginBottom: 6 }}>
            <li>Open Telegram, search for <code>@BotFather</code>, send <code>/newbot</code>. Pick any name & username. BotFather replies with a <strong>bot token</strong> — paste it above.</li>
            <li>To get your <strong>chat ID</strong>: open <code>@userinfobot</code> in Telegram and press Start. It replies with your numeric ID. Paste that above.</li>
            <li>Send any message to your new bot (so it can DM you back), then click <strong>Save &amp; Send Test</strong>.</li>
          </ol>
          <strong style={{ color: '#f1f5f9' }}>For a group instead of a personal DM:</strong> add the bot to the group, send one message in the group, then open <code>https://api.telegram.org/bot&lt;YOUR_TOKEN&gt;/getUpdates</code> in a browser — find <code>"chat":{'{'}"id":-100…{'}'}</code> and use that negative number.
        </div>
      )}
    </div>
  );
}

function fmtDuration(ms) {
  if (ms == null || ms <= 0) return '0m';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState({});
  const [pages, setPages] = useState([]);
  const [, force] = useState(0);
  const [personal, setPersonal] = useState(null); // { page, html }

  function reloadPages() { api.getPages().then(setPages).catch(() => {}); }

  async function openPersonal(p) {
    try {
      const r = await api.getPersonalPage(p.id);
      setPersonal({ page: p, html: r.html_code });
    } catch (err) { toast(err.message); }
  }

  async function resetPersonal(p) {
    if (!confirm('Remove your personalization for "' + p.name + '" and go back to the shared template?')) return;
    try {
      await api.resetPersonalPage(p.id);
      toast('Reverted to the shared template.');
      reloadPages();
    } catch (err) { toast(err.message); }
  }

  const license = user?.license;
  const remaining = license && license.expires_at ? new Date(license.expires_at).getTime() - Date.now() : null;
  const licenseActive = license && license.active && (remaining == null || remaining > 0);

  useEffect(() => {
    if (!licenseActive) return;
    api.getStats().then(setStats).catch(() => {});
    reloadPages();
  }, [licenseActive]);

  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (license && !licenseActive) {
    return (
      <div>
        <div className="page-header"><div><h1>Welcome, {user?.name}</h1><p>Your subscription has expired.</p></div></div>
        <div className="section-card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
          <h2 style={{ marginBottom: 8 }}>Subscribe to continue</h2>
          <p style={{ color: '#475569', marginBottom: 20 }}>
            Your landing pages are currently offline. Visitors hitting any of your deployed shims will see a blank page until your license is renewed.
          </p>
          <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: 24 }}>
            Plans available: <strong>Weekly (7 days)</strong> or <strong>Monthly (30 days)</strong>.<br/>
            Contact your admin to activate or renew.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh status</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header"><div><h1>Welcome, {user?.name}</h1><p>Your dashboard overview.</p></div></div>

      {license && license.plan && remaining != null && (
        <div className="section-card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subscription</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{license.plan === 'weekly' ? 'Weekly' : 'Monthly'} plan</div>
            <div style={{ fontSize: '0.85rem', color: '#475569' }}>Expires {new Date(license.expires_at).toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Time remaining</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: remaining < 86400000 ? '#b45309' : '#065f46' }}>{fmtDuration(remaining)}</div>
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card stat-purple">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg></div>
          <div><div className="stat-value">{stats.pages || 0}</div><div className="stat-label">My Pages</div></div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/></svg></div>
          <div><div className="stat-value">{stats.versions || 0}</div><div className="stat-label">File Versions</div></div>
        </div>
        <div className="stat-card stat-orange">
          <div className="stat-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM12 7h5v2h-5zm0 4h5v2h-5zm0 4h5v2h-5zM7 7h2v2H7zm0 4h2v2H7zm0 4h2v2H7z"/></svg></div>
          <div><div className="stat-value">{stats.deployments || 0}</div><div className="stat-label">Deployments</div></div>
        </div>
      </div>

      <TelegramCard />

      <div className="two-col">
        <div className="section-card">
          <h3>My Landing Pages</h3>
          <p className="desc">Pages available for you to manage.</p>
          {pages.length === 0 ? (
            <p style={{ color: '#475569', fontSize: '0.85rem' }}>No landing pages yet. Ask your admin to create pages.</p>
          ) : (
            pages.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1e2230' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>
                    {p.name}
                    {p.has_variant && <span className="badge badge-green" style={{ marginLeft: 8 }}>Personalized</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.created}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => openPersonal(p)}>Personalize</button>
                  {p.has_variant && <button className="btn btn-outline btn-sm" onClick={() => resetPersonal(p)}>Reset</button>}
                  <span className={'badge ' + (p.status === 'active' ? 'badge-green' : 'badge-yellow')}>{p.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="section-card">
          <h3>Quick Actions</h3>
          <p className="desc">Common tasks.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => navigate('/user/files')}>Manage My Files</button>
            <button className="btn btn-outline" onClick={() => navigate('/user/analytics')}>View Analytics</button>
          </div>
        </div>
      </div>

      {personal && (
        <PersonalizeModal
          title={'Personalize: ' + personal.page.name}
          initialHtml={personal.html}
          onClose={() => setPersonal(null)}
          onSave={async (html) => {
            await api.savePersonalPage(personal.page.id, html);
            toast('Your personalized version is live on all your deployments.');
            setPersonal(null);
            reloadPages();
          }}
        />
      )}
    </div>
  );
}
