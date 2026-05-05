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

// When the current tab is an /employee/* URL, transparently add ?analyst_id=<name>
// to every API call. The value is the logged-in user's *name*, which is what
// the backend filters every employee-scoped column by (assigned_to, analyst, etc).
// The legacy aml_active_analyst key is honoured as a fallback for any
// localStorage state left from before the login system.
api.interceptors.request.use((config) => {
  try {
    const path = window.location.pathname || '';
    if (path.startsWith('/employee')) {
      let analystName = null;
      const raw = localStorage.getItem(USER_KEY);
      if (raw) {
        const u = JSON.parse(raw);
        if (u?.name) analystName = u.name;
      }
      if (!analystName) {
        analystName = localStorage.getItem(LEGACY_ANALYST_KEY);
      }
      if (analystName) {
        config.params = { ...(config.params || {}), analyst_id: analystName };
      }
    }
  } catch (_e) { /* ignore */ }
  return config;
});

export default api;
