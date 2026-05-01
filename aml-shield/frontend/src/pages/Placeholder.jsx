import { Construction } from 'lucide-react';

export default function Placeholder({ title }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 text-slate-500">
      <Construction size={40} className="mb-3 text-slate-400" />
      <div className="text-lg font-semibold text-navy-900">{title}</div>
      <div className="text-sm mt-1">This module is part of the Crowe ARC roadmap.</div>
    </div>
  );
}
