import { useState, useRef, useEffect } from 'react';
import { Search, Bell, User, ChevronDown, Briefcase, UserCheck, Check } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useRole } from '../state/RoleContext.jsx';

const TITLES = {
  '/': 'Dashboard',
  '/alerts': 'TM Alerts',
  '/cases': 'SAR Cases',
  '/investigations': 'Investigations',
  '/customers': 'Customer KYC',
  '/sars': 'SAR Repository',
  '/retention': 'Retention Monitor',
  '/audit': 'Audit Trail',
  '/reports': 'Reports',
  '/analytics': 'Analytics',
  '/users': 'Users',
  '/settings': 'Settings'
};

export default function Topbar() {
  const loc = useLocation();
  const { role, setRole, currentAnalyst, setCurrentAnalyst, analysts, isManager } = useRole();
  const [open, setOpen] = useState(false);
  const popRef = useRef();

  useEffect(() => {
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const base = '/' + (loc.pathname.split('/')[1] || '');
  const title = TITLES[base] || TITLES[loc.pathname] || 'AML Shield';

  const identityName = isManager ? 'Compliance Manager' : (currentAnalyst || 'Compliance Analyst');
  const identitySub  = isManager ? 'Manager View · full oversight' : `Employee View · ${currentAnalyst || '—'}`;

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 sticky top-0 z-20">
      <div>
        <div className="text-lg font-semibold text-navy-900">{title}</div>
        <div className="text-xs text-slate-500">
          AML Shield · Suspicious Activity &amp; SAR Management
        </div>
      </div>
      <div className="flex-1 max-w-md mx-auto relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search alerts, cases, SARs…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-slate-100 rounded-md border border-transparent focus:border-blue-500 focus:bg-white focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-3 ml-auto relative" ref={popRef}>
        <button className="relative w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
        </button>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 pl-3 border-l border-slate-200 py-1 pr-2 rounded-md hover:bg-slate-50"
          title="Switch view"
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white ${isManager ? 'bg-indigo-600' : 'bg-blue-600'}`}>
            {isManager ? <Briefcase size={16} /> : <User size={16} />}
          </div>
          <div className="leading-tight text-left">
            <div className="text-sm font-medium text-navy-900 flex items-center gap-1">
              {identityName}
              <ChevronDown size={14} className="text-slate-400" />
            </div>
            <div className="text-xs text-slate-500">{identitySub}</div>
          </div>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-30 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Switch View</div>
            </div>

            <button
              onClick={() => { setRole('manager'); setOpen(false); }}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${role === 'manager' ? 'bg-indigo-50' : ''}`}
            >
              <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white shrink-0">
                <Briefcase size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-navy-900">Manager View</div>
                  {role === 'manager' && <Check size={14} className="text-indigo-600" />}
                </div>
                <div className="text-xs text-slate-500">Full team oversight, all alerts / cases / SARs, read-only SAR actions.</div>
              </div>
            </button>

            <div className="border-t border-slate-100" />

            <button
              onClick={() => { setRole('employee'); setOpen(false); }}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${role === 'employee' ? 'bg-blue-50' : ''}`}
            >
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                <UserCheck size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-navy-900">Employee View</div>
                  {role === 'employee' && <Check size={14} className="text-blue-600" />}
                </div>
                <div className="text-xs text-slate-500">Personal queue — only alerts &amp; cases assigned to the selected analyst.</div>
              </div>
            </button>

            {role === 'employee' && (
              <div className="px-4 py-3 border-t border-slate-100 bg-blue-50/30">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Analyst</label>
                <select
                  value={currentAnalyst || ''}
                  onChange={e => setCurrentAnalyst(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white"
                >
                  {analysts.length === 0 && <option>Loading…</option>}
                  {analysts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}

            <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
              rakshit.sapra@crowe.com
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
