const BASE = '';

async function request(method, url, body, isFormData) {
  const opts = { method, credentials: 'include' };
  if (body && !isFormData) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  if (isFormData) {
    opts.body = body;
  }
  const res = await fetch(BASE + url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

const api = {
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),

  getUsers: () => request('GET', '/api/users'),
  createUser: (data) => request('POST', '/api/users', data),
  updateUser: (id, data) => request('PUT', '/api/users/' + id, data),
  deleteUser: (id) => request('DELETE', '/api/users/' + id),
  setUserLicense: (id, body) => request('POST', '/api/users/' + id + '/license', body),

  getPages: () => request('GET', '/api/pages'),
  createPage: (data) => request('POST', '/api/pages', data),
  updatePage: (id, data) => request('PUT', '/api/pages/' + id, data),
  deletePage: (id) => request('DELETE', '/api/pages/' + id),

  uploadFile: (pageId, formData, onProgress) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/pages/' + pageId + '/upload');
      xhr.withCredentials = true;
      if (onProgress) xhr.upload.onprogress = onProgress;
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error || 'Upload failed'));
        else resolve(data);
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });
  },
  addLink: (pageId, data) => request('POST', '/api/pages/' + pageId + '/link', data),
  activateVersion: (id) => request('PUT', '/api/versions/' + id + '/activate'),
  deleteVersion: (id) => request('DELETE', '/api/versions/' + id),

  rotatePageShimSecret: (pageId) => request('POST', '/api/pages/' + pageId + '/rotate-shim-secret'),
  getMyDeployment: (pageId) => request('GET', '/api/pages/' + pageId + '/my-deployment'),
  shimZipUrl: (pageId) => '/api/pages/' + pageId + '/shim-zip',

  getLinks: () => request('GET', '/api/links'),

  getBotStats: () => request('GET', '/api/bot-stats'),
  getBotBlocks: (page, limit) => request('GET', '/api/bot-blocks?page=' + (page || 1) + '&limit=' + (limit || 50)),
  getBotIpList: () => request('GET', '/api/bot-ip-list'),
  addBotIp: (data) => request('POST', '/api/bot-ip-list', data),
  removeBotIp: (id) => request('DELETE', '/api/bot-ip-list/' + id),
  clearBotBlocks: () => request('DELETE', '/api/bot-blocks'),

  getMyAnalytics: () => request('GET', '/api/my-analytics'),
  getMyVisitorLogs: (page, limit) => request('GET', '/api/my-visitor-logs?page=' + (page || 1) + '&limit=' + (limit || 50)),

  getVisitorStats: () => request('GET', '/api/visitor-stats'),
  getVisitorLogs: (page, limit, filters) => {
    let url = '/api/visitor-logs?page=' + (page || 1) + '&limit=' + (limit || 50);
    if (filters) {
      if (filters.country) url += '&country=' + encodeURIComponent(filters.country);
      if (filters.blocked !== undefined && filters.blocked !== '') url += '&blocked=' + filters.blocked;
      if (filters.from) url += '&from=' + filters.from;
      if (filters.to) url += '&to=' + filters.to;
    }
    return request('GET', url);
  },
  clearVisitorLogs: () => request('DELETE', '/api/visitor-logs'),

  getStats: () => request('GET', '/api/stats'),
  getActivity: () => request('GET', '/api/activity'),
  getSettings: () => request('GET', '/api/settings'),
  updateSettings: (data) => request('PUT', '/api/settings', data),
  testAdminTelegram: () => request('POST', '/api/settings/telegram-test'),

  getMyTelegram: () => request('GET', '/api/me/telegram'),
  updateMyTelegram: (data) => request('PUT', '/api/me/telegram', data),
  testMyTelegram: () => request('POST', '/api/me/telegram/test'),
};

export default api;
