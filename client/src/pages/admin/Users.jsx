import React, { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

function fmtRemaining(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'Expired';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return d + 'd ' + h + 'h';
  return h + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function licenseBadge(u) {
  if (u.role === 'Admin') return <span className="badge badge-blue">Admin</span>;
  const lic = u.license;
  if (!lic || !lic.expires_at) return <span className="badge badge-gray">None</span>;
  const ms = new Date(lic.expires_at).getTime() - Date.now();
  if (ms <= 0) return <span className="badge badge-red">Expired</span>;
  const colorClass = ms < 86400000 ? 'badge-yellow' : 'badge-green';
  return <span className={'badge ' + colorClass}>{lic.plan} · {fmtRemaining(ms)}</span>;
}

export default function Users() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'User', status: 'Active' });
  const [licensePlan, setLicensePlan] = useState('weekly');

  function load() { api.getUsers().then(setUsers).catch(() => {}); }
  useEffect(load, []);

  function openNew() {
    setEditId(null);
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'User', status: 'Active' });
    setLicensePlan('weekly');
    setModal(true);
  }

  function openEdit(u) {
    setEditId(u.id);
    setEditUser(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role, status: u.status });
    setLicensePlan(u.license?.plan === 'monthly' ? 'monthly' : 'weekly');
    setModal(true);
  }

  async function licenseAction(action) {
    if (!editId) return;
    try {
      const body = action === 'revoke' ? { action } : { action, plan: licensePlan };
      await api.setUserLicense(editId, body);
      toast('License ' + action + 'd');
      const fresh = await api.getUsers();
      setUsers(fresh);
      const updated = fresh.find(u => u.id === editId);
      if (updated) setEditUser(updated);
    } catch (err) { toast(err.message); }
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) { toast('Name and email required'); return; }
    if (!editId && !form.password) { toast('Password required for new user'); return; }
    try {
      const data = { ...form };
      if (editId && !data.password) delete data.password;
      if (editId) {
        await api.updateUser(editId, data);
        toast('User updated');
      } else {
        await api.createUser(data);
        toast('User created');
      }
      setModal(false);
      load();
    } catch (err) { toast(err.message); }
  }

  async function del(id, name) {
    if (!confirm('Delete user "' + name + '"?')) return;
    try {
      await api.deleteUser(id);
      toast('User deleted');
      load();
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>Users</h1><p>Manage user accounts.</p></div>
        <button className="btn btn-primary" onClick={openNew}>+ Add User</button>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {users.length === 0 ? (
          <div className="empty-state"><p>No users yet.</p><button className="btn btn-primary" onClick={openNew}>Add First User</button></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>License</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600, color: '#f1f5f9' }}>{u.name}</td>
                  <td style={{ color: '#94a3b8' }}>{u.email}</td>
                  <td><span className={'badge ' + (u.role === 'Admin' ? 'badge-blue' : 'badge-gray')}>{u.role}</span></td>
                  <td><span className={'badge ' + (u.status === 'Active' ? 'badge-green' : 'badge-red')}>{u.status}</span></td>
                  <td>{licenseBadge(u)}</td>
                  <td style={{ color: '#64748b' }}>{u.created}</td>
                  <td>
                    <div className="btn-row">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => del(u.id, u.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        title={editId ? 'Edit User' : 'Add User'}
        show={modal}
        onClose={() => setModal(false)}
        footer={<>
          <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save User</button>
        </>}
      >
        <div className="form-row">
          <div className="form-group">
            <label>Name</label>
            <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
          </div>
        </div>
        <div className="form-group">
          <label>Password {editId && <span style={{ color: '#475569', fontWeight: 400 }}>(leave blank to keep current)</span>}</label>
          <input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={editId ? '••••••••' : 'Enter password'} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Role</label>
            <select className="form-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="User">User</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        {editId && form.role !== 'Admin' && (
          <div className="form-group" style={{ borderTop: '1px solid #1e2230', paddingTop: 16, marginTop: 16 }}>
            <label>License</label>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 10 }}>
              {editUser?.license?.expires_at ? (
                <>Current: <strong>{editUser.license.plan}</strong> · expires {new Date(editUser.license.expires_at).toLocaleString()} · {fmtRemaining(new Date(editUser.license.expires_at).getTime() - Date.now())}</>
              ) : (
                <>No license issued</>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="form-select" style={{ width: 'auto' }} value={licensePlan} onChange={e => setLicensePlan(e.target.value)}>
                <option value="weekly">Weekly (7 days)</option>
                <option value="monthly">Monthly (30 days)</option>
              </select>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => licenseAction('activate')}>Activate</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => licenseAction('extend')}>+ Extend</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => licenseAction('revoke')}>Revoke now</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
