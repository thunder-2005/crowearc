import axios from 'axios';

const USER_KEY = 'aml_shield_user';
const LEGACY_ANALYST_KEY = 'aml_active_analyst';

// In production, point straight at the Railway backend (VITE_API_URL).
// In development, leave baseURL pointed at /api so Vite's dev-server proxy
// handles /api/* → http://localhost:4000.
const baseURL = import.meta.env.PROD
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' }
});

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

// Single interceptor handles three concerns:
//   1. x-user-role / x-user-id headers — read on every request so a fresh
//      login or sign-out is reflected without a page reload.
//   2. /employee/* analyst_id query param (legacy mechanic the backend
//      still relies on for assigned_to filtering).
//   3. Legacy aml_active_analyst fallback for any localStorage state from
//      before the login system existed.
api.interceptors.request.use((config) => {
  try {
    const user = readUser();

    // Per-request role/id headers — used by the backend for lightweight
    // route-level authorisation (e.g. "L1 cannot file SARs").
    if (user) {
      config.headers = config.headers || {};
      if (user.role) config.headers['x-user-role'] = user.role;
      if (user.id != null) config.headers['x-user-id'] = String(user.id);
      if (user.name) config.headers['x-user-name'] = user.name;
    }

    // analyst_id query param — only on /employee/* URLs.
    const path = window.location.pathname || '';
    if (path.startsWith('/employee')) {
      let analystName = user?.name || null;
      if (!analystName) analystName = localStorage.getItem(LEGACY_ANALYST_KEY);
      if (analystName) {
        config.params = { ...(config.params || {}), analyst_id: analystName };
      }
    }
  } catch (_e) { /* ignore */ }
  return config;
});

export default api;
