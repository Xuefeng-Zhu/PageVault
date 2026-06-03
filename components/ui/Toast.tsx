'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  description?: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, opts?: { type?: ToastType; description?: string }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const accentMap: Record<ToastType, { bar: string; icon: ReactNode; iconClass: string }> = {
  success: {
    bar: 'bg-signal-bright',
    icon: <CheckCircle2 className="w-4 h-4" />,
    iconClass: 'text-signal',
  },
  error: {
    bar: 'bg-ember-bright',
    icon: <AlertCircle className="w-4 h-4" />,
    iconClass: 'text-ember',
  },
  info: {
    bar: 'bg-ink',
    icon: <Info className="w-4 h-4" />,
    iconClass: 'text-ink-2',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback<ToastContextType['showToast']>((message, opts) => {
    const id = Math.random().toString(36).slice(2, 11);
    const type: ToastType = opts?.type ?? 'info';
    setToasts((prev) => [...prev, { id, message, description: opts?.description, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-6 right-6 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => {
          const a = accentMap[t.type];
          return (
            <div
              key={t.id}
              className="pointer-events-auto relative bg-surface-raised border border-rule shadow-paper-md overflow-hidden toast-enter"
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${a.bar}`} />
              <div className="flex items-start gap-3 pl-4 pr-3 py-3">
                <span className={`mt-0.5 shrink-0 ${a.iconClass}`}>{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-body-md text-ink leading-snug">{t.message}</p>
                  {t.description && (
                    <p className="font-mono text-mono-sm text-ink-3 mt-0.5">{t.description}</p>
                  )}
                </div>
                <button
                  onClick={() => dismissToast(t.id)}
                  className="text-ink-4 hover:text-ink transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
export function showToast(message: string, typeOrOpts: ToastType | { type?: ToastType; description?: string } = 'info') {
  // Unified signature: callers can pass a plain type or an options object.
  const opts = typeof typeOrOpts === 'string' ? { type: typeOrOpts } : typeOrOpts;
  const event = new CustomEvent('show-toast', { detail: { message, ...opts } });
  window.dispatchEvent(event);
}
