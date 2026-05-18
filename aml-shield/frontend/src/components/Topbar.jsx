import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search, Bell, User, ChevronDown, Briefcase, Check, FileText, AlertTriangle,
  ShieldAlert, X, Loader2, FolderOpen, LogOut
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useRole } from '../state/RoleContext.jsx';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { useToast } from '../state/ToastContext.jsx';
import api from '../api/client.js';
import { isAlertClosed } from '../utils/alertStatus.js';

// Page title resolution: the consumer below tries a full-path key first
// (so `/bsa/dashboard` can show "BSA Officer Command Center" instead of the
// generic "Dashboard"), then falls back to the URL segment key for legacy
// routes that don't need role-specific titles.
const TITLES = {
  // Segment keys — used by /manager/* and /employee/* surfaces.
  'dashboard':       'Dashboard',
  'alerts':          'TM Alerts',
  'cases':           'SAR Cases',
  'investigations':  'Investigations',
  'customers':       'Customer KYC',
  'sars':            'SAR Repository',
  'sar-approvals':   'SAR Approval Queue',
  'sar-approval':    'SAR Review',
  'sar-filing':      'Create SAR',
  'kyc-reviews':     'KYC Reviews',
  'kyc-review':      'KYC Review',
  'retention':       'Retention Monitor',
  'audit':           'Audit Trail',
  'reports':         'Reports',
  'analytics':       'Analytics',
  'users':           'Users',
  'settings':        'Settings',
  // Full-path keys — used by /bsa/* surfaces (added after the BSA Command
  // Center shipped; the generic segment titles above didn't fit).
  '/bsa/dashboard':                'BSA Officer Command Center',
  '/bsa/alerts':                   'All Alerts — Read Only',
  '/bsa/cases':                    'All Cases — Read Only',
  '/bsa/customers':                'Customer Profiles — Read Only',
  '/bsa/sar-repository':           'SAR Repository',
  '/bsa/sar-approvals':            'SAR Final Sign-off Queue',
  '/bsa/retention':                'Retention Monitor',
  '/bsa/audit-trail':              'Audit Trail',
  '/bsa/reopen-requests':          'Alert Reopen Authorizations',
  '/bsa/regulatory-correspondence':'Regulatory Correspondence'
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
  const { goTo } = useRoleNavigate();
  const { currentAnalyst, currentUser, analystProfiles, currentAnalystLevel, isManager, isBsa, isBsaOfficer, isL1, signOut } = useRole();
  const toast = useToast();
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const bellRef = useRef();
  const userMenuRef = useRef();

  const handleSignOut = () => {
    setUserMenuOpen(false);
    signOut();
    try { toast.push('You have been signed out successfully', 'success', 3000); } catch (_e) { /* ignore */ }
  };

  // Global search
  const searchRef = useRef();
  const searchInputRef = useRef();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState({ alerts: [], customers: [], cases: [], sars: [] });

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
  useEffect(() => { if (bellOpen) refreshList(); }, [bellOpen, refreshList]);

  useEffect(() => {
    const onClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Ctrl+K / Cmd+K → focus search anywhere in the app
  useEffect(() => {
    const onKey = (e) => {
      const isModK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
      if (isModK) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search fetch (300ms) — re-runs on query change
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults({ alerts: [], customers: [], cases: [], sars: [] });
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(() => {
      const params = { q, role: isManager ? 'manager' : 'employee' };
      api.get('/search', { params })
        .then(r => setSearchResults(r.data || { alerts: [], customers: [], cases: [], sars: [] }))
        .catch(() => setSearchResults({ alerts: [], customers: [], cases: [], sars: [] }))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery, isManager]);

  // Close dropdown on route change
  useEffect(() => {
    setSearchOpen(false);
  }, [loc.pathname]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchFocused(false);
    searchInputRef.current?.blur();
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults({ alerts: [], customers: [], cases: [], sars: [] });
    searchInputRef.current?.focus();
  }, []);

  const onSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery) clearSearch();
      else closeSearch();
    }
  };

  const handleSearchNavigate = useCallback((kind, item) => {
    closeSearch();
    setSearchQuery('');
    if (kind === 'alert') {
      goTo('alerts');
    } else if (kind === 'customer') {
      goTo(`customers/${encodeURIComponent(item.customer_id)}`);
    } else if (kind === 'case') {
      goTo('cases');
    } else if (kind === 'sar') {
      goTo(`sars?sar_id=${encodeURIComponent(item.sar_id)}`);
    } else if (kind === 'more-alerts') {
      goTo('alerts');
    } else if (kind === 'more-customers') {
      goTo('customers');
    } else if (kind === 'more-cases') {
      goTo('cases');
    } else if (kind === 'more-sars') {
      goTo('sars');
    }
  }, [closeSearch, goTo]);

  // L1 analysts get no SAR visibility — even if the backend slips a row
  // through, drop it before counting/rendering.
  const showSarResults = !isL1;
  const totalResults =
    searchResults.alerts.length +
    searchResults.customers.length +
    searchResults.cases.length +
    (showSarResults ? searchResults.sars.length : 0);
  const dropdownVisible = searchOpen && searchQuery.trim().length >= 2;

  // Title resolution: full path first (so BSA-specific routes can override
  // the generic segment titles), then segment as fallback.
  const seg = loc.pathname.split('/').filter(Boolean);
  const sectionKey = seg[1] || 'dashboard';
  // Normalize the full-path key to strip a trailing :id for routes like
  // /bsa/sar-approval/SAR-00001 — we want '/bsa/sar-approval' to match.
  const fullPathKey = seg.length >= 2 ? `/${seg[0]}/${seg[1]}` : loc.pathname;
  const title = TITLES[fullPathKey] || TITLES[sectionKey] || 'Crowe ARC';

  const onNotificationClick = async (n) => {
    if (!n.is_read) {
      try { await api.patch(`/notifications/${n.id}/read`); } catch (_e) {}
    }
    setBellOpen(false);
    if (n.related_type === 'sar') {
      if (isManager && n.type === 'sar_pending') {
        goTo(`sar-approval/${n.related_id}`);
      } else if (n.type === 'sar_rejected') {
        try {
          const { data } = await api.get(`/sar-filings/${n.related_id}`);
          if (data?.case_id) goTo(`sar-filing/${data.case_id}`);
          else goTo('sars');
        } catch (_e) { goTo('sars'); }
      } else if (n.type === 'sar_approved') {
        goTo('sars');
      }
    } else if (n.related_type === 'alert') {
      goTo('alerts');
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
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 sticky top-0 z-[45]">
      <div>
        <div className="text-lg font-semibold text-navy-900">{title}</div>
        <div className="text-xs text-slate-500">
          Crowe ARC · Suspicious Activity &amp; SAR Management
        </div>
      </div>
      <div className="flex-1 flex justify-center mx-auto">
        <div
          ref={searchRef}
          className="relative"
          style={{
            width: searchFocused || dropdownVisible ? 560 : 420,
            transition: 'width 0.18s ease-out'
          }}
        >
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => { setSearchFocused(true); if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search alerts, customers, SARs, cases..."
            className="w-full pl-9 pr-20 py-2 text-sm bg-slate-100 rounded-md border border-transparent focus:border-blue-500 focus:bg-white focus:outline-none"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="p-1 rounded hover:bg-slate-200 text-slate-500"
                title="Clear"
              >
                <X size={14} />
              </button>
            )}
            {!searchQuery && (
              <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 rounded">
                Ctrl K
              </kbd>
            )}
          </div>

          {dropdownVisible && (
            <SearchResultsDropdown
              query={searchQuery.trim()}
              loading={searchLoading}
              results={searchResults}
              total={totalResults}
              showSarResults={showSarResults}
              onSelect={handleSearchNavigate}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 ml-auto">
        {/* Role badge — BSA Officer is keyed off the logged-in user's role
            (follows the person across routes); the other badges follow the
            URL surface the analyst is currently looking at. */}
        <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
          isBsaOfficer
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : isBsa
              ? 'bg-sky-50 text-sky-700 border-sky-200'
              : isManager
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'bg-green-50 text-green-700 border-green-200'
        }`}>
          {(isBsaOfficer || isBsa || isManager) ? <Briefcase size={12} /> : <User size={12} />}
          {isBsaOfficer
            ? 'BSA Officer'
            : isBsa
              ? 'BSA Officer'
              : isManager
                ? 'Manager View'
                : 'Employee View'}
        </span>

        {/* Bell */}
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
            <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] overflow-hidden">
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
                  onClick={() => { setBellOpen(false); goTo('sar-approvals'); }}
                  className="w-full text-center text-xs text-blue-600 hover:bg-slate-50 py-2 border-t border-slate-100"
                >
                  View All in Approval Queue →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Identity / sign-out menu */}
        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen(o => !o)}
            className="flex items-center gap-2 pl-3 border-l border-slate-200 py-1 pr-2 rounded-md hover:bg-slate-50"
            title={currentUser?.name ? `Signed in as ${currentUser.name}` : 'Account'}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
              style={{ backgroundColor: currentUser?.avatar_color || (isManager ? '#4F46E5' : '#2563EB') }}
            >
              {currentUser?.name
                ? currentUser.name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
                : (isManager ? <Briefcase size={16} /> : <User size={16} />)}
            </div>
            <div className="leading-tight text-left">
              <div className="text-sm font-medium text-navy-900 flex items-center gap-1.5">
                {currentUser?.name || (isManager ? 'Compliance Manager' : 'Account')}
                {currentAnalystLevel && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    currentAnalystLevel === 'L2'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>{currentAnalystLevel}</span>
                )}
              </div>
              <div className={`text-xs ${isBsaOfficer ? 'text-teal-700 font-medium' : 'text-slate-500'}`}>
                {isBsaOfficer
                  ? 'BSA Officer · program oversight'
                  : isManager
                    ? 'Manager View · full oversight'
                    : `Employee View · ${analystProfiles[currentAnalyst]?.team || 'Analyst'}`}
              </div>
            </div>
            <ChevronDown size={14} className="text-slate-400 ml-1" />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="text-sm font-semibold text-navy-900 truncate">
                  {currentUser?.name || 'Signed in'}
                </div>
                {currentUser?.username && (
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                    {currentUser.username}
                  </div>
                )}
                {currentUser?.role && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {currentUser.role.replace(/_/g, ' ')}
                  </div>
                )}
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Global search dropdown
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_DOT = {
  High:   'bg-red-500',
  Medium: 'bg-orange-500',
  Low:    'bg-green-500'
};
const RISK_TONE = {
  High:   'bg-red-100 text-red-700',
  Medium: 'bg-orange-100 text-orange-700',
  Low:    'bg-green-100 text-green-700'
};
const STATUS_TONE = {
  // alert
  Unassigned:        'bg-slate-100 text-slate-700',
  'Not Started':     'bg-orange-100 text-orange-700',
  'In Progress':     'bg-blue-100 text-blue-700',
  Completed:         'bg-green-100 text-green-700',
  'Escalated - L2':  'bg-purple-100 text-purple-700',
  'Escalated - SAR': 'bg-purple-100 text-purple-700',
  // case
  // ('In Progress' key is already defined above for alert_status; the
  // case-status STATUS_TONE entry was removed because the canonical case
  // status is now 'In Progress' as well.)
  'Pending Review':  'bg-indigo-100 text-indigo-700',
  Filed:             'bg-green-100 text-green-700',
  Closed:            'bg-slate-100 text-slate-700',
  // sar
  Draft:             'bg-slate-100 text-slate-700',
  'Under Review':    'bg-indigo-100 text-indigo-700',
  Acknowledged:      'bg-green-100 text-green-700',
  // kyc
  Compliant:         'bg-green-100 text-green-700',
  Pending:           'bg-orange-100 text-orange-700',
  Overdue:           'bg-red-100 text-red-700'
};

function slaLabel(a) {
  // Closed alerts have no live SLA timer; the search-row pill is hidden for them.
  if (isAlertClosed(a)) return null;
  if (!a.sla_deadline) return a.due_status || '';
  const remainingMs = new Date(a.sla_deadline.length <= 10 ? `${a.sla_deadline}T23:59:59` : a.sla_deadline).getTime() - Date.now();
  if (Number.isNaN(remainingMs)) return '';
  if (remainingMs <= 0) return 'Breached';
  if (remainingMs <= 24 * 3600000) return 'At Risk';
  return 'On Time';
}
const SLA_TONE = {
  Breached: 'text-red-700',
  'At Risk': 'text-orange-700',
  'On Time': 'text-green-700'
};

function initials(name) {
  return (name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(s => s[0].toUpperCase()).join('') || '?';
}

function CategoryHeader({ children }) {
  return (
    <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

function ResultBadge({ label, tone }) {
  if (!label) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${tone || 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
}

function AlertResultRow({ item, onClick }) {
  const sla = slaLabel(item);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-b-0"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[item.priority] || 'bg-slate-400'}`} />
      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-navy-900 font-semibold shrink-0">{item.alert_id}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-700 truncate">{item.customer_name}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500 text-xs truncate">{item.scenario}</span>
      </div>
      <ResultBadge label={item.alert_status} tone={STATUS_TONE[item.alert_status]} />
      {sla && <span className={`text-[10px] font-medium ${SLA_TONE[sla] || 'text-slate-500'}`}>{sla}</span>}
    </button>
  );
}

function CustomerResultRow({ item, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-b-0"
    >
      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-semibold shrink-0">
        {initials(item.customer_name)}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        <span className="text-navy-900 font-medium truncate">{item.customer_name}</span>
        <span className="text-slate-400">·</span>
        <span className="font-mono text-xs text-slate-500 shrink-0">{item.customer_id}</span>
      </div>
      {item.customer_risk_rating && (
        <ResultBadge label={item.customer_risk_rating} tone={RISK_TONE[item.customer_risk_rating]} />
      )}
      {item.kyc_review_status && (
        <ResultBadge label={item.kyc_review_status} tone={STATUS_TONE[item.kyc_review_status]} />
      )}
    </button>
  );
}

function CaseResultRow({ item, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-b-0"
    >
      <FolderOpen size={16} className="text-indigo-500 shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-navy-900 font-semibold shrink-0">{item.case_id}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-700 truncate">{item.customer_name}</span>
      </div>
      <ResultBadge label={item.case_status} tone={STATUS_TONE[item.case_status]} />
      <span className="text-[10px] text-slate-500 truncate max-w-[120px]">{item.assigned_to || 'Unassigned'}</span>
    </button>
  );
}

function SarResultRow({ item, onClick }) {
  const date = item.filed_date || item.draft_created_date;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-b-0"
    >
      <FileText size={16} className="text-emerald-600 shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-navy-900 font-semibold shrink-0">{item.sar_id}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-700 truncate">{item.customer_name}</span>
      </div>
      {date && <span className="text-[10px] text-slate-500">{date}</span>}
      <ResultBadge label={item.sar_status} tone={STATUS_TONE[item.sar_status]} />
    </button>
  );
}

function MoreLink({ visible, label, onClick }) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 border-t border-slate-100"
    >
      View all {label} →
    </button>
  );
}

function SearchResultsDropdown({ query, loading, results, total, showSarResults = true, onSelect }) {
  const empty = !loading && total === 0;
  return (
    <div
      className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] overflow-hidden"
      style={{ maxHeight: 480 }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            Searching…
          </div>
        )}

        {!loading && empty && (
          <div className="py-8 px-6 text-center">
            <div className="text-sm font-medium text-navy-900">
              No results for &lsquo;{query}&rsquo;
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Try searching by ID, customer name, or scenario
            </div>
          </div>
        )}

        {!loading && results.alerts.length > 0 && (
          <div>
            <CategoryHeader>Alerts</CategoryHeader>
            {results.alerts.map(a => (
              <AlertResultRow key={a.alert_id} item={a} onClick={() => onSelect('alert', a)} />
            ))}
            <MoreLink
              visible={!!results.alerts_more}
              label="alerts"
              onClick={() => onSelect('more-alerts')}
            />
          </div>
        )}

        {!loading && results.customers.length > 0 && (
          <div>
            <CategoryHeader>Customers</CategoryHeader>
            {results.customers.map(c => (
              <CustomerResultRow key={c.customer_id} item={c} onClick={() => onSelect('customer', c)} />
            ))}
            <MoreLink
              visible={!!results.customers_more}
              label="customers"
              onClick={() => onSelect('more-customers')}
            />
          </div>
        )}

        {!loading && results.cases.length > 0 && (
          <div>
            <CategoryHeader>SAR Cases</CategoryHeader>
            {results.cases.map(cs => (
              <CaseResultRow key={cs.case_id} item={cs} onClick={() => onSelect('case', cs)} />
            ))}
            <MoreLink
              visible={!!results.cases_more}
              label="cases"
              onClick={() => onSelect('more-cases')}
            />
          </div>
        )}

        {showSarResults && !loading && results.sars.length > 0 && (
          <div>
            <CategoryHeader>SAR Filings</CategoryHeader>
            {results.sars.map(s => (
              <SarResultRow key={s.sar_id} item={s} onClick={() => onSelect('sar', s)} />
            ))}
            <MoreLink
              visible={!!results.sars_more}
              label="filings"
              onClick={() => onSelect('more-sars')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
