import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon, Lock, Eye, EyeOff, Loader2,
  ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';
import api from '../api/client.js';
import CroweArcLogo from '../components/CroweArcLogo.jsx';

const USER_KEY = 'aml_shield_user';
const LEGACY_ANALYST_KEY = 'aml_active_analyst';

const DEMO_USERS = [
  { role: 'Compliance Manager', username: 'henry.morgan',  password: 'Henry@123'   },
  { role: 'BSA Officer',        username: 'james.carter',  password: 'James@123'   },
  { role: 'L2 Analyst',         username: 'olivia.brown',  password: 'Olivia@123'  },
  { role: 'L2 Analyst',         username: 'cassian.jude',  password: 'Cassian@123' },
  { role: 'L2 Analyst',         username: 'marie.davis',   password: 'Marie@123'   },
  { role: 'L2 Analyst',         username: 'hannah.louise', password: 'Hannah@123'  },
  { role: 'L1 Analyst',         username: 'robert.wright', password: 'Robert@123'  },
  { role: 'L1 Analyst',         username: 'arjun.sharma',  password: 'Arjun@123'   },
  { role: 'L1 Analyst',         username: 'priya.nair',    password: 'Priya@123'   },
  { role: 'L1 Analyst',         username: 'rohit.mehta',   password: 'Rohit@123'   },
  { role: 'L1 Analyst',         username: 'neha.iyer',     password: 'Neha@123'    },
  { role: 'L1 Analyst',         username: 'vikram.sinha',  password: 'Vikram@123'  }
];

function landingFor(role) {
  // BSA Officer shares the manager landing until a dedicated BSA Officer
  // dashboard ships. Program-level oversight responsibilities overlap
  // enough that the manager view is the closer fit today; the /bsa/* nav
  // remains accessible from the manager surface for BSA-specific tasks.
  if (role === 'compliance_manager') return '/manager/dashboard';
  if (role === 'bsa_officer')        return '/manager/dashboard';
  return '/employee/dashboard';
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoOpen, setDemoOpen] = useState(false);

  // If a user is already logged in, skip the login screen.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) {
        const u = JSON.parse(raw);
        if (u?.role) navigate(landingFor(u.role), { replace: true });
      }
    } catch (_e) { /* ignore */ }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      if (data?.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        // Keep the legacy key in sync so any code path still reading it
        // (Axios interceptor, RoleContext) keeps working with no flicker.
        if (data.user.role !== 'compliance_manager') {
          localStorage.setItem(LEGACY_ANALYST_KEY, data.user.name);
        } else {
          try { localStorage.removeItem(LEGACY_ANALYST_KEY); } catch (_e) { /* ignore */ }
        }
        navigate(landingFor(data.user.role), { replace: true });
      } else {
        setError(data?.message || 'Invalid username or password. Please try again.');
        setPassword('');
      }
    } catch (err) {
      setError('Invalid username or password. Please try again.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const useDemo = (u) => {
    setUsername(u.username);
    setPassword(u.password);
    setError('');
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ backgroundColor: '#0F172A' }}
    >
      {/* ─── Login card ──────────────────────────────────────────────── */}
      <div className="w-full max-w-[420px] bg-white rounded-xl shadow-2xl p-8">
        <div className="flex flex-col items-center text-center">
          <CroweArcLogo size={56} />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Crowe ARC</h1>
          <p className="text-sm text-slate-500 mt-1">Alert Review &amp; Casework</p>
        </div>

        <div className="my-6 border-t border-slate-200" />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Username</label>
            <div className="relative">
              <UserIcon
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="firstname.lastname"
                autoComplete="username"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Sign-in button */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </form>

        <div className="my-6 border-t border-slate-200" />

        <div className="text-center text-xs text-slate-500 leading-relaxed">
          <div className="font-semibold text-slate-700">First National Bank — US</div>
          <div className="mt-1">Internal Compliance Tool — Authorized Users Only</div>
          <div className="mt-2 text-slate-400">v1.0.0</div>
        </div>
      </div>

      {/* ─── Demo credentials panel ──────────────────────────────────── */}
      <div className="w-full max-w-[680px] mt-6">
        <button
          type="button"
          onClick={() => setDemoOpen((o) => !o)}
          className="w-full px-4 py-3 bg-slate-800 text-slate-200 rounded-md flex items-center justify-between hover:bg-slate-700 transition-colors"
        >
          <span className="text-sm font-medium">Demo Access — Click to {demoOpen ? 'collapse' : 'expand'}</span>
          {demoOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {demoOpen && (
          <div className="mt-2 bg-white rounded-md overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Role</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Username</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Password</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_USERS.map((u) => (
                    <tr key={u.username} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-800">{u.role}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{u.username}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{u.password}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => useDemo(u)}
                          className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
