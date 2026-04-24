import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertCircle };
const TONES = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error:   'bg-red-50 border-red-200 text-red-800',
  info:    'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-orange-50 border-orange-200 text-orange-800'
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, tone = 'success', duration = 3000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, tone }]);
    if (duration > 0) {
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
    }
    return id;
  }, []);

  const remove = (id) => setToasts(t => t.filter(x => x.id !== id));

  return (
    <ToastContext.Provider value={{ push, remove }}>
      {children}
      <div className="fixed top-20 right-6 z-50 flex flex-col gap-2">
        {toasts.map(t => {
          const Icon = ICONS[t.tone] || Info;
          return (
            <div key={t.id}
              className={`flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg min-w-[260px] max-w-[380px] ${TONES[t.tone] || TONES.info}`}>
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="text-sm flex-1">{t.message}</div>
              <button onClick={() => remove(t.id)} className="p-0.5 rounded hover:bg-black/5">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}
