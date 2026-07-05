import React, { useEffect, useState } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../AuthContext';

export default function Settings() {
  const toast = useToast();
  const { user } = useAuth();
  const [settings, setSettings] = useState({ siteName: 'SC Landing Pages', siteUrl: window.location.origin });
  const [profileForm, setProfileForm] = useState({ name: '', email: '', password: '' });

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(prev => ({ ...prev, ...s, siteUrl: s.siteUrl || window.location.origin }));
    }).catch(() => {});
    if (user) {
      setProfileForm({ name: user.name, email: user.email, password: '' });
    }
  }, [user]);

  async function saveSettings() {
    try {
      await api.updateSettings(settings);
      toast('Settings saved');
    } catch (err) { toast(err.message); }
  }

  async function saveProfile() {
    if (!profileForm.name || !profileForm.email) { toast('Name and email required'); return; }
    try {
      const data = { name: profileForm.name, email: profileForm.email };
      if (profileForm.password) data.password = profileForm.password;
      await api.updateUser(user.id, data);
      toast('Profile updated. Changes take effect on next login.');
    } catch (err) { toast(err.message); }
  }

  async function testTelegram() {
    try {
      await api.updateSettings({ telegram_bot_token: settings.telegram_bot_token || '', telegram_chat_id: settings.telegram_chat_id || '' });
      await api.testAdminTelegram();
      toast('Test sent — check your Telegram chat.');
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="page-header"><div><h1>Settings</h1><p>Manage application settings and your profile.</p></div></div>

      <div className="two-col">
        <div className="section-card">
          <h3>Application Settings</h3>
          <p className="desc">General configuration.</p>
          <div className="form-group">
            <label>Site Name</label>
            <input className="form-input" value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Site URL</label>
            <input className="form-input" value={settings.siteUrl || ''} onChange={e => setSettings({ ...settings, siteUrl: e.target.value })} placeholder="https://example.com" />
          </div>
          <div className="form-group">
            <label>IP2Location API Key</label>
            <input className="form-input" type="password" value={settings.ip2location_api_key || ''} onChange={e => setSettings({ ...settings, ip2location_api_key: e.target.value })} placeholder="Enter your IP2Location.io API key" />
            <small style={{ color: '#475569', fontSize: '0.72rem' }}>Used for VPN/proxy/datacenter detection on landing page visitors.</small>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid #1e2230', margin: '18px 0' }} />
          <h4 style={{ marginTop: 0, marginBottom: 4, fontSize: '0.95rem' }}>Telegram alerts (global)</h4>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 0, marginBottom: 12 }}>
            Every download across the system is mirrored to this channel. Individual users can also configure their own Telegram from their dashboard — they get a private copy of their own page downloads in addition to this global feed.
          </p>
          <div className="form-group">
            <label>Bot Token</label>
            <input className="form-input" type="password" value={settings.telegram_bot_token || ''} onChange={e => setSettings({ ...settings, telegram_bot_token: e.target.value })} placeholder="123456789:AAH…" autoComplete="new-password" />
            <small style={{ color: '#475569', fontSize: '0.72rem' }}>Create a bot in Telegram via <code>@BotFather</code> → <code>/newbot</code>. It hands you a token.</small>
          </div>
          <div className="form-group">
            <label>Chat ID</label>
            <input className="form-input" value={settings.telegram_chat_id || ''} onChange={e => setSettings({ ...settings, telegram_chat_id: e.target.value })} placeholder="e.g. 123456789 or -1001234567890" />
            <small style={{ color: '#475569', fontSize: '0.72rem' }}>For a personal chat: open <code>@userinfobot</code> in Telegram and start it — it replies with your numeric ID. For a group: add the bot to the group, then visit <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.</small>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={saveSettings}>Save Settings</button>
            <button className="btn btn-outline" onClick={testTelegram}>Save & Send Test</button>
          </div>
        </div>

        <div className="section-card">
          <h3>Admin Profile</h3>
          <p className="desc">Update your account details.</p>
          <div className="form-group">
            <label>Name</label>
            <input className="form-input" value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="form-input" type="email" value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label>New Password <span style={{ color: '#475569', fontWeight: 400 }}>(leave blank to keep current)</span></label>
            <input className="form-input" type="password" value={profileForm.password} onChange={e => setProfileForm({ ...profileForm, password: e.target.value })} placeholder="••••••••" />
          </div>
          <button className="btn btn-primary" onClick={saveProfile}>Update Profile</button>
        </div>
      </div>
    </div>
  );
}
