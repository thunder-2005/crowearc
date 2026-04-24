import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, AlertTriangle, Briefcase, Search, FileText,
  FolderOpen, Clock, ShieldCheck, Activity, BarChart3, Users, Settings,
  ChevronRight, Shield, IdCard
} from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';

const ALL_SECTIONS = [
  {
    title: 'MONITORING',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true, roles: ['manager', 'employee'] },
      { to: '/alerts', icon: AlertTriangle, label: 'TM Alerts', roles: ['manager', 'employee'] },
      { to: '/cases', icon: Briefcase, label: 'Cases', roles: ['manager', 'employee'] },
      { to: '/customers', icon: IdCard, label: 'Customer KYC', roles: ['manager', 'employee'] },
      { to: '/investigations', icon: Search, label: 'Investigations', roles: ['manager'] }
    ]
  },
  {
    title: 'SAR MANAGEMENT',
    items: [
      { to: '/sars', icon: FileText, label: 'SAR Repository', roles: ['manager', 'employee'] },
      { to: '/sars', icon: ChevronRight, label: 'SARs', nested: true, roles: ['manager'] },
      { to: '/sars?view=docs', icon: FolderOpen, label: 'Supporting Docs', nested: true, roles: ['manager'] },
      { to: '/sars?view=search', icon: Search, label: 'Search', nested: true, roles: ['manager'] },
      { to: '/retention', icon: Clock, label: 'Retention Monitor', roles: ['manager'] },
      { to: '/audit', icon: ShieldCheck, label: 'Audit Trail', roles: ['manager'] }
    ]
  },
  {
    title: 'REPORTS',
    items: [
      { to: '/reports', icon: Activity, label: 'Reports', roles: ['manager'] },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', roles: ['manager'] }
    ]
  },
  {
    title: 'ADMIN',
    items: [
      { to: '/users', icon: Users, label: 'Users', roles: ['manager', 'employee'] },
      { to: '/settings', icon: Settings, label: 'Settings', roles: ['manager', 'employee'] }
    ]
  }
];

export default function Sidebar() {
  const { role } = useRole();
  const sections = ALL_SECTIONS
    .map(section => ({
      ...section,
      items: section.items.filter(it => it.roles.includes(role))
    }))
    .filter(section => section.items.length > 0);

  return (
    <aside className="w-64 shrink-0 bg-navy-900 text-slate-200 flex flex-col h-screen sticky top-0">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-navy-800">
        <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
          <Shield size={20} className="text-white" />
        </div>
        <div>
          <div className="text-white font-semibold leading-tight">AML Shield</div>
          <div className="text-[11px] text-slate-400 leading-tight">
            {role === 'manager' ? 'Manager Workspace' : 'Analyst Workspace'}
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
                return (
                  <li key={it.label + it.to}>
                    <NavLink
                      to={it.to}
                      end={it.end}
                      className={({ isActive }) =>
                        `flex items-center gap-3 text-sm rounded-md px-3 py-2 transition-colors ${
                          it.nested ? 'pl-8 text-slate-400' : ''
                        } ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-300 hover:bg-navy-800 hover:text-white'
                        }`
                      }
                    >
                      <Icon size={16} />
                      <span>{it.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-5 py-3 border-t border-navy-800 text-xs text-slate-500">
        v1.1 · CSV-seeded
      </div>
    </aside>
  );
}
