export default function Card({ title, subtitle, action, children, className = '', bodyClassName = '' }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <div>
            {title && <div className="text-sm font-semibold text-navy-900">{title}</div>}
            {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

export function KpiCard({ label, value, sub, tone = 'default', icon: Icon }) {
  const toneMap = {
    default: 'text-navy-900',
    blue:    'text-blue-600',
    green:   'text-green-600',
    orange:  'text-orange-600',
    red:     'text-red-600'
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 transition-colors hover:border-[#E0EEFF] hover:cursor-pointer">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
        {Icon && <Icon size={16} className="text-slate-400" />}
      </div>
      <div className={`mt-2 text-2xl font-bold ${toneMap[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
