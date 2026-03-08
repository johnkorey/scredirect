import React, { useEffect, useState } from 'react';
import api from '../../api';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../AuthContext';

export default function Settings() {
  const toast = useToast();
  const { user } = useAuth();
  const [settings, setSettings] = useState({ siteName: 'SC Landing Pages', siteUrl: '' });
  const [profileForm, setProfileForm] = useState({ name: '', email: '', password: '' });

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(prev => ({ ...prev, ...s }));
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
          <button className="btn btn-primary" onClick={saveSettings}>Save Settings</button>
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
