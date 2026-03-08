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

  getPages: () => request('GET', '/api/pages'),
  createPage: (data) => request('POST', '/api/pages', data),
  updatePage: (id, data) => request('PUT', '/api/pages/' + id, data),
  deletePage: (id) => request('DELETE', '/api/pages/' + id),

  uploadFile: (pageId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', '/api/pages/' + pageId + '/upload', fd, true);
  },
  activateVersion: (id) => request('PUT', '/api/versions/' + id + '/activate'),
  deleteVersion: (id) => request('DELETE', '/api/versions/' + id),

  getDomains: () => request('GET', '/api/domains'),
  createDomain: (data) => request('POST', '/api/domains', data),
  updateDomain: (id, data) => request('PUT', '/api/domains/' + id, data),
  deleteDomain: (id) => request('DELETE', '/api/domains/' + id),
  domainSSL: (id, action) => request('POST', '/api/domains/' + id + '/ssl', { action }),

  getLinks: () => request('GET', '/api/links'),

  getBotStats: () => request('GET', '/api/bot-stats'),
  getBotBlocks: (page, limit) => request('GET', '/api/bot-blocks?page=' + (page || 1) + '&limit=' + (limit || 50)),
  getBotIpList: () => request('GET', '/api/bot-ip-list'),
  addBotIp: (data) => request('POST', '/api/bot-ip-list', data),
  removeBotIp: (id) => request('DELETE', '/api/bot-ip-list/' + id),
  clearBotBlocks: () => request('DELETE', '/api/bot-blocks'),

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
};

export default api;
