import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Bell, User, ChevronDown, Briefcase, UserCheck, Check, FileText, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRole } from '../state/RoleContext.jsx';
import api from '../api/client.js';

const TITLES = {
  '/': 'Dashboard',
  '/alerts': 'TM Alerts',
  '/cases': 'SAR Cases',
  '/investigations': 'Investigations',
  '/customers': 'Customer KYC',
  '/sars': 'SAR Repository',
  '/sar-approvals': 'SAR Approval Queue',
  '/sar-approval': 'SAR Review',
  '/sar-filing': 'Create SAR',
  '/retention': 'Retention Monitor',
  '/audit': 'Audit Trail',
  '/reports': 'Reports',
  '/analytics': 'Analytics',
  '/users': 'Users',
  '/settings': 'Settings'
};

const NOTIFICATION_ICONS = {
  sar_pending:  FileText,
  sar_approved: Check,
  sar_rejected: AlertTriangle,
  sla_breach:   AlertTriangle,
  escalation:   ShieldAlert,
  high_priority_alert: AlertTriangle
};
const NOTIFICATION_TONE_DOT = {
  warning: 'bg-orange-500',
  success: 'bg-green-500',
  error:   'bg-red-500',
  info:    'bg-blue-500'
};

function relativeTime(iso) {
  if (!iso) return '';
  const t = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const dt = new Date(t);
  if (isNaN(dt.getTime())) return iso;
  const diff = (Date.now() - dt.getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export default function Topbar() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { role, setRole, currentAnalyst, setCurrentAnalyst, analysts, isManager } = useRole();
  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const popRef = useRef();
  const bellRef = useRef();

  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState([]);

  const recipientPath = useCallback(
    () => isManager ? 'manager' : `user/${encodeURIComponent(currentAnalyst || '')}`,
    [isManager, currentAnalyst]
  );

  const refreshCount = useCallback(() => {
    if (!isManager && !currentAnalyst) { setUnread(0); return; }
    api.get(`/notifications/unread-count/${recipientPath()}`)
      .then(r => setUnread(r.data.count || 0))
      .catch(() => {});
  }, [isManager, currentAnalyst, recipientPath]);

  const refreshList = useCallback(() => {
    if (!isManager && !currentAnalyst) { setNotifications([]); return; }
    api.get(`/notifications/${recipientPath()}`)
      .then(r => setNotifications(r.data || []))
      .catch(() => {});
  }, [isManager, currentAnalyst, recipientPath]);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 30000);
    const onFocus = () => refreshCount();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [refreshCount]);

  useEffect(() => { refreshCount(); }, [loc.pathname, refreshCount]);

  useEffect(() => {
    if (bellOpen) refreshList();
  }, [bellOpen, refreshList]);

  useEffect(() => {
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const base = '/' + (loc.pathname.split('/')[1] || '');
  const title = TITLES[base] || TITLES[loc.pathname] || 'AML Shield';

  const identityName = isManager ? 'Compliance Manager' : (currentAnalyst || 'Compliance Analyst');
  const identitySub  = isManager ? 'Manager View · full oversight' : `Employee View · ${currentAnalyst || '—'}`;

  const onNotificationClick = async (n) => {
    if (!n.is_read) {
      try { await api.patch(`/notifications/${n.id}/read`); } catch (_e) {}
    }
    setBellOpen(false);
    if (n.related_type === 'sar') {
      if (isManager && (n.type === 'sar_pending')) {
        navigate(`/sar-approval/${n.related_id}`);
      } else if (n.type === 'sar_rejected') {
        try {
          const { data } = await api.get(`/sar-filings/${n.related_id}`);
          if (data?.case_id) navigate(`/sar-filing/${data.case_id}`);
          else navigate('/sars');
        } catch (_e) { navigate('/sars'); }
      } else if (n.type === 'sar_approved') {
        navigate('/sars');
      }
    } else if (n.related_type === 'alert') {
      navigate('/alerts');
    }
    refreshCount();
  };

  const markAllRead = async () => {
    try {
      await api.patch(`/notifications/read-all/${recipientPath()}`);
      refreshCount();
      refreshList();
    } catch (_e) {}
  };

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
      <div className="flex items-center gap-3 ml-auto relative">
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen(o => !o)}
            className="relative w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600"
            title="Notifications"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-slate-200 rounded-lg shadow-xl z-30 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-navy-900">Notifications</div>
                  <div className="text-[11px] text-slate-500">{unread} unread</div>
                </div>
                {notifications.length > 0 && (
                  <button onClick={markAllRead}
                    className="text-xs text-blue-600 hover:underline">Mark all as read</button>
                )}
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">No notifications</div>
                ) : notifications.map(n => {
                  const Icon = NOTIFICATION_ICONS[n.type] || Bell;
                  const dot = NOTIFICATION_TONE_DOT[n.tone] || 'bg-slate-400';
                  return (
                    <button
                      key={n.id}
                      onClick={() => onNotificationClick(n)}
                      className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 ${n.is_read ? '' : 'bg-blue-50/30'}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 ${dot}`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-navy-900 truncate">{n.title}</div>
                        {n.message && (
                          <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.message}</div>
                        )}
                        <div className="text-[11px] text-slate-400 mt-1">{relativeTime(n.created_at)}</div>
                      </div>
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              {isManager && (
                <button
                  onClick={() => { setBellOpen(false); navigate('/sar-approvals'); }}
                  className="w-full text-center text-xs text-blue-600 hover:bg-slate-50 py-2 border-t border-slate-100"
                >
                  View All in Approval Queue →
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={popRef} className="relative">
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
      </div>
    </header>
  );
}
