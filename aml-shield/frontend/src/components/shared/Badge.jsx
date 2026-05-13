const STATUS_STYLES = {
  'Filed':            'bg-green-100 text-green-700',
  'In Progress':      'bg-blue-100 text-blue-700',
  'Pending Review':   'bg-orange-100 text-orange-700',
  'Not Started':      'bg-slate-200 text-slate-700',
  'Unassigned':       'bg-slate-100 text-slate-600',
  'Closed':           'bg-slate-200 text-slate-700',
  'Completed':        'bg-green-100 text-green-700',
  'Open':             'bg-blue-100 text-blue-700',
  'Investigating':    'bg-indigo-100 text-indigo-700',
  'Escalated':        'bg-red-100 text-red-700',
  'SLA Breached':     'bg-red-100 text-red-700',
  'Breached':         'bg-red-100 text-red-700',
  'At Risk':          'bg-orange-100 text-orange-700',
  'On Track':         'bg-green-100 text-green-700',
  'High':             'bg-red-100 text-red-700',
  'Medium':           'bg-orange-100 text-orange-700',
  'Low':              'bg-green-100 text-green-700',
  'Draft':            'bg-slate-200 text-slate-700',
  'Under Review':     'bg-orange-100 text-orange-700',
  'Acknowledged':     'bg-indigo-100 text-indigo-700',
  'Active':           'bg-green-100 text-green-700',
  'Legal Hold':       'bg-red-100 text-red-700',
  'Pending Filing':   'bg-slate-100 text-slate-600'
};

export default function Badge({ children, value, className = '' }) {
  const key = value || children;
  const style = STATUS_STYLES[key] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style} ${className}`}>
      {children || value}
    </span>
  );
}
