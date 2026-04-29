import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, AlertTriangle, Briefcase, Search, FileText,
  FolderOpen, Clock, ShieldCheck, Activity, BarChart3, Users, Settings,
  Shield, IdCard, Inbox, ClipboardCheck
} from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import api from '../api/client.js';

const MANAGER_SECTIONS = [
  {
    title: 'MONITORING',
    items: [
      { to: 'dashboard',            icon: LayoutDashboard, label: 'Dashboard' },
      { to: 'alerts',               icon: AlertTriangle,   label: 'All Alerts' },
      { to: 'cases',                icon: Briefcase,       label: 'All Cases' },
      { to: 'investigations',       icon: Search,          label: 'Investigations' }
    ]
  },
  {
    title: 'CUSTOMERS',
    items: [
      { to: 'customers',            icon: IdCard,         label: 'Customer KYC' },
      { to: 'kyc-reviews',          icon: ClipboardCheck, label: 'KYC Reviews', badge: 'overdueReviews' }
    ]
  },
  {
    title: 'SAR MANAGEMENT',
    items: [
      { to: 'sars',                 icon: FileText,    label: 'SAR Repository' },
      { to: 'sar-approvals',        icon: Inbox,       label: 'SAR Approvals', badge: 'pendingApprovals' },
      { to: 'retention',            icon: Clock,       label: 'Retention Monitor' }
    ]
  },
  {
    title: 'REPORTS',
    items: [
      { to: 'analytics',            icon: BarChart3, label: 'Analytics' },
      { to: 'reports',              icon: Activity,  label: 'Reports' }
    ]
  },
  {
    title: 'ADMIN',
    items: [
      { to: 'users',                icon: Users,    label: 'Users' },
      { to: 'settings',             icon: Settings, label: 'Settings' }
    ]
  }
];

const EMPLOYEE_SECTIONS = [
  {
    title: 'MY WORK',
    items: [
      { to: 'dashboard',            icon: LayoutDashboard, label: 'My Dashboard' },
      { to: 'alerts',               icon: AlertTriangle,   label: 'My Alerts' },
      { to: 'cases',                icon: Briefcase,       label: 'My Cases' },
      { to: 'kyc-reviews/mine',     icon: ClipboardCheck,  label: 'My KYC Reviews', badge: 'myAssignedReviews' }
    ]
  },
  {
    title: 'CUSTOMERS',
    items: [
      { to: 'customers',            icon: IdCard, label: 'Customer KYC' }
    ]
  },
  {
    title: 'SAR MANAGEMENT',
    items: [
      { to: 'sars',                 icon: FileText,   label: 'SAR Repository' },
      { to: 'cases',                icon: FolderOpen, label: 'File SAR' }
    ]
  },
  {
    title: 'REPORTS',
    items: [
      { to: 'reports',              icon: Activity, label: 'My Reports' }
    ]
  },
  {
    title: 'ADMIN',
    items: [
      { to: 'settings',             icon: Settings, label: 'Settings' }
    ]
  }
];

export default function Sidebar() {
  const { role, isManager, currentAnalyst } = useRole();
  const { makePath } = useRoleNavigate();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [overdueReviews, setOverdueReviews] = useState(0);
  const [myAssignedReviews, setMyAssignedReviews] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (isManager) {
          const [{ data: sar }, { data: kyc }] = await Promise.all([
            api.get('/sar-approvals/stats'),
            api.get('/kyc-reviews/stats')
          ]);
          if (!cancelled) {
            setPendingApprovals(sar.pending || 0);
            setOverdueReviews(kyc.overdue || 0);
          }
        } else if (currentAnalyst) {
          const { data } = await api.get('/kyc-reviews', {
            params: { assigned_to: currentAnalyst, status: 'in_progress' }
          });
          if (!cancelled) setMyAssignedReviews((data || []).length);
        }
      } catch (_e) { /* keep last value */ }
    };
    load();
    const id = setInterval(load, 30000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [isManager, currentAnalyst]);

  const badges = { pendingApprovals, overdueReviews, myAssignedReviews };
  const sections = isManager ? MANAGER_SECTIONS : EMPLOYEE_SECTIONS;

  return (
    <aside className="w-64 shrink-0 bg-navy-900 text-slate-200 flex flex-col h-screen sticky top-0">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-navy-800">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isManager ? 'bg-indigo-600' : 'bg-blue-600'}`}>
          <Shield size={20} className="text-white" />
        </div>
        <div>
          <div className="text-white font-semibold leading-tight">AML Shield</div>
          <div className="text-[11px] text-slate-400 leading-tight">
            {isManager ? 'Manager Workspace' : 'Analyst Workspace'}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {sections.map((section) => (
          <div key={section.title} className="px-3 mb-5">
            <div className="text-[10px] font-semibold text-slate-500 tracking-wider px-3 mb-2">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((it) => {
                const Icon = it.icon;
                const badgeVal = it.badge ? badges[it.badge] : 0;
                return (
                  <li key={it.label + it.to}>
                    <NavLink
                      to={makePath(it.to)}
                      end={it.to === 'dashboard'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 text-sm rounded-md px-3 py-2 transition-colors ${
                          isActive
                            ? (isManager ? 'bg-indigo-600 text-white' : 'bg-blue-600 text-white')
                            : 'text-slate-300 hover:bg-navy-800 hover:text-white'
                        }`
                      }
                    >
                      <Icon size={16} />
                      <span className="flex-1">{it.label}</span>
                      {badgeVal > 0 && (
                        <span className="text-[10px] font-semibold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {badgeVal}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-5 py-3 border-t border-navy-800 text-xs text-slate-500">
        v1.3 · {role}
      </div>
    </aside>
  );
}
