export default function Toggle({ checked, onChange, disabled = false, label, sub }) {
  return (
    <label className={`inline-flex items-start gap-3 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={!!checked}
          onChange={e => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="block w-10 h-5 bg-slate-300 rounded-full peer-checked:bg-blue-600 transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
      </span>
      {(label || sub) && (
        <span className="leading-tight">
          {label && <span className="text-sm text-navy-900 block">{label}</span>}
          {sub && <span className="text-xs text-slate-500 block">{sub}</span>}
        </span>
      )}
    </label>
  );
}
