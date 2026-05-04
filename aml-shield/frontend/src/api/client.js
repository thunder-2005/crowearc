import axios from 'axios';

const ANALYST_KEY = 'aml_active_analyst';

// In production, point straight at the Railway backend (VITE_API_URL).
// In development, leave baseURL empty so Vite's dev-server proxy handles
// /api/* → http://localhost:4000.
const baseURL = import.meta.env.PROD
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' }
});

// When the current tab is an /employee/* URL, transparently add ?analyst_id=<active analyst>
// to every API call. Existing query params (assigned_to, etc.) are preserved.
api.interceptors.request.use((config) => {
  try {
    const path = window.location.pathname || '';
    if (path.startsWith('/employee')) {
      const analyst = localStorage.getItem(ANALYST_KEY);
      if (analyst) {
        config.params = { ...(config.params || {}), analyst_id: analyst };
      }
    }
  } catch (_e) { /* ignore */ }
  return config;
});

export default api;
