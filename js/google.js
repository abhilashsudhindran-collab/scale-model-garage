// Google sign-in (Identity Services token model) + the Drive/Sheets calls the app needs.
// This is the ONLY module that talks to Google (architecture: storage adapter).
//
// Security (design doc 5):
// - OAuth Client ID is entered once on the phone and kept in this browser's localStorage, never in the repo.
//   The R0 test kit's saved Client ID (same website) is reused if present.
// - The access token lives in memory only and disappears when the app closes.
// - Scope drive.file only: the app sees only files it created.
// - Every request has a time limit (Part E #18).

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID_KEY = 'smg.clientId';
const R0_CLIENT_ID_KEY = 'sgr0.clientId';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let token = null;
let tokenClient = null;
let pending = null;

export const getClientId = () => localStorage.getItem(CLIENT_ID_KEY) || localStorage.getItem(R0_CLIENT_ID_KEY) || '';
export const setClientId = (id) => localStorage.setItem(CLIENT_ID_KEY, String(id).trim());
export const hasToken = () => !!token && Date.now() < token.expires_at - 60_000;
export const tokenMinutesLeft = () => (token ? Math.max(0, Math.round((token.expires_at - Date.now()) / 60000)) : 0);

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in (no internet?)'));
    document.head.append(s);
  });
}

// Call from a tap: may open a Google window (a brief self-closing one when consent already exists).
export async function signIn({ prompt = '' } = {}) {
  const clientId = getClientId();
  if (!clientId) throw new Error('No Google Client ID set on this phone yet (Settings)');
  await loadGis();
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (!pending) return;
        const { resolve, reject } = pending; pending = null;
        if (resp.error) return reject(new Error(`${resp.error}: ${resp.error_description || ''}`));
        token = { access_token: resp.access_token, expires_at: Date.now() + Number(resp.expires_in) * 1000 };
        resolve(true);
      },
      error_callback: (err) => {
        if (!pending) return;
        const { reject } = pending; pending = null;
        reject(new Error(`Sign-in window problem: ${err.type || JSON.stringify(err)}`));
      },
    });
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
}

export class ApiError extends Error {
  constructor(message, status, retryable) { super(message); this.status = status; this.retryable = retryable; }
}

async function api(url, { method = 'GET', headers = {}, body, raw = false, timeoutMs = 30_000 } = {}) {
  if (!hasToken()) throw new ApiError('Signed out or sign-in expired — tap Sync or Sign in', 401, false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, body, signal: ctrl.signal, headers: { Authorization: `Bearer ${token.access_token}`, ...headers } });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? `Timed out after ${Math.round(timeoutMs / 1000)} s` : `Network error: ${e.message}`, 0, true);
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
    if (res.status === 401) token = null;
    throw new ApiError(`HTTP ${res.status} ${method} ${url.split('?')[0].split('/').slice(-2).join('/')} — ${detail}`, res.status, retryable);
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const json = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
const q = encodeURIComponent;

export const drive = {
  createFolder: (name, parentId, appProperties) => api(`${DRIVE}/files?fields=id,name`, {
    method: 'POST', ...json({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}), ...(appProperties ? { appProperties } : {}) }),
  }),
  get: (id, fields = 'id,name,trashed,md5Checksum,size') => api(`${DRIVE}/files/${id}?fields=${q(fields)}`),
  list: (query, fields = 'files(id,name,md5Checksum,size,appProperties,trashed)') =>
    api(`${DRIVE}/files?q=${q(query)}&fields=${q(fields)}&pageSize=100&spaces=drive`),
  move: (id, addParent, removeParents) =>
    api(`${DRIVE}/files/${id}?addParents=${addParent}&removeParents=${removeParents}&fields=id`, { method: 'PATCH', ...json({}) }),
  upload: async (blob, { name, parents, appProperties, mimeType }) => {
    const boundary = 'smg' + Math.random().toString(16).slice(2);
    const metaJson = { name, ...(parents ? { parents } : {}), ...(appProperties ? { appProperties } : {}) };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(metaJson),
      `\r\n--${boundary}\r\nContent-Type: ${mimeType || blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`,
    ]);
    return api(`${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum,size`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, timeoutMs: 90_000,
    });
  },
  update: (id, metadata) => api(`${DRIVE}/files/${id}?fields=id`, { method: 'PATCH', ...json(metadata) }),
  copy: (id, name, parentId) => api(`${DRIVE}/files/${id}/copy?fields=id,name`, { method: 'POST', ...json({ name, parents: [parentId] }) }),
  about: () => api(`${DRIVE}/about?fields=storageQuota`),
  download: async (id) => (await api(`${DRIVE}/files/${id}?alt=media`, { raw: true, timeoutMs: 90_000 })).blob(),
};

export const sheets = {
  create: (title, tabs) => api(`${SHEETS}?fields=spreadsheetId,sheets.properties`, {
    method: 'POST', ...json({ properties: { title }, sheets: tabs.map(t => ({ properties: { title: t } })) }),
  }),
  meta: (id) => api(`${SHEETS}/${id}?fields=sheets.properties(title,sheetId)`),
  addTabs: (id, titles) => api(`${SHEETS}/${id}:batchUpdate`, {
    method: 'POST', ...json({ requests: titles.map(title => ({ addSheet: { properties: { title } } })) }),
  }),
  // One read request for several ranges.
  batchGet: (id, ranges) => api(`${SHEETS}/${id}/values:batchGet?${ranges.map(r => 'ranges=' + q(r)).join('&')}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`),
  // One write request for several ranges. RAW = stored exactly as sent (no formulas, no number parsing).
  batchUpdate: (id, data) => api(`${SHEETS}/${id}/values:batchUpdate`, {
    method: 'POST', ...json({ valueInputOption: 'RAW', data: data.map(d => ({ range: d.range, majorDimension: 'ROWS', values: d.values })) }),
  }),
  append: (id, range, values) => api(`${SHEETS}/${id}/values/${q(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', ...json({ majorDimension: 'ROWS', values }),
  }),
};
