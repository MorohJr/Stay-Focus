import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { back } from '../router';

// ---------------------------------------------------------------------------
// Bottom sheet: native <dialog> for focus and Escape handling
// ---------------------------------------------------------------------------

export function Sheet({ open, title, onClose, children }: { open: boolean; title?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
    >
      {open && (
        <div className="sheet-in">
          <div className="sheet-grip" aria-hidden="true" />
          {title && (
            <div className="sheet-h">
              <h2>{title}</h2>
              <button type="button" className="topbar iconbtn" style={{ margin: 0, minHeight: 0 }} onClick={onClose} aria-label="סגור">
                <Icon name="x" />
              </button>
            </div>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toast with optional undo
// ---------------------------------------------------------------------------

interface ToastState {
  message: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(t: ToastState) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((t: ToastState) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" aria-live="polite">
        {toast && (
          <div>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function TopBar({ title, backTo, children }: { title: ReactNode; backTo?: string | true; children?: ReactNode }) {
  return (
    <div className="topbar">
      {backTo && (
        <button type="button" className="backbtn" onClick={() => back(typeof backTo === 'string' ? backTo : '/')} aria-label="חזרה">
          <Icon name="chevR" />
        </button>
      )}
      <h1 className="ellipsis">{title}</h1>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="seg">
      {items.map((it) => (
        <button key={it.id} type="button" className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Empty({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {icon && <span className="big">{icon}</span>}
      {children}
    </div>
  );
}

/** Concentric progress rings (R-TOD-9). pct null = no data. */
export function Rings({ rings, size = 132 }: { rings: { pct: number | null; color: string }[]; size?: number }) {
  const sw = 12;
  const gap = 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {rings.map((r, i) => {
        const rad = size / 2 - sw / 2 - i * (sw + gap);
        const c = 2 * Math.PI * rad;
        return (
          <g key={i}>
            <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--track)" strokeWidth={sw} />
            {r.pct !== null && r.pct > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={rad}
                fill="none"
                stroke={r.color}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeDasharray={`${(c * Math.min(r.pct, 100)) / 100} ${c}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Bar({ pct, thick }: { pct: number; thick?: boolean }) {
  return (
    <div className={`bar ${thick ? 'thick' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
