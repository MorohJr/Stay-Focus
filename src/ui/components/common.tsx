import { cloneElement, createContext, Fragment, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icon';
import { back } from '../router';
import { todayISO, weekNumber } from '../../domain/dates';
import { reducedMotion, useGlass } from '../design';

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

export interface HeadStat {
  v: ReactNode;
  k: string;
  /** Glass look (R-UI-8): a line icon in a circle beside the number. */
  icon?: string;
}

// ---------------------------------------------------------------------------
// R-UI-10: numbers count up (glass look only)
// ---------------------------------------------------------------------------

/** Counts from what is on screen to `to`: from 0 on mount, from the old value on change. */
export function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const decimals = Number.isInteger(to) ? 0 : 1;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (n: number) => n.toFixed(decimals);
    const from = shown.current;
    if (reducedMotion() || from === to) {
      shown.current = to;
      el.textContent = fmt(to);
      return;
    }
    el.textContent = fmt(from);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1000);
      shown.current = from + (to - from) * (1 - Math.pow(1 - p, 4));
      el.textContent = fmt(p < 1 ? shown.current : to);
      if (p < 1) raf = requestAnimationFrame(step);
      else shown.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, decimals]);
  return <span ref={ref} className="num" />;
}

/** Every number inside (plain numbers, digits in text, nested elements) counts up. */
export function countify(node: ReactNode): ReactNode {
  if (typeof node === 'number') return Number.isFinite(node) ? <CountUp to={node} /> : node;
  if (typeof node === 'string') {
    const parts = node.split(/(\d+(?:\.\d+)?)/);
    return parts.length === 1 ? node : parts.map((x, i) => (i % 2 ? <CountUp key={i} to={Number(x)} /> : x));
  }
  if (Array.isArray(node)) return node.map((n, i) => <Fragment key={i}>{countify(n as ReactNode)}</Fragment>);
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) return cloneElement(node, undefined, countify(node.props.children));
  return node;
}

/** Counts up in the glass look; plain in classic. */
export function Num({ children }: { children: ReactNode }) {
  const glass = useGlass();
  return <>{glass ? countify(children) : children}</>;
}

/** Glass: a pill that slides under the active button of a tab row or a segmented control (R-UI-11). */
function placeSlider(box: HTMLElement | null, el: HTMLElement | null, placed: { current: boolean }) {
  const on = box?.querySelector<HTMLElement>(':scope > .on');
  if (!el) return;
  el.style.opacity = on ? '1' : '0';
  if (!on) return;
  if (!placed.current) el.style.transition = 'none'; // the first time it just appears in place
  el.style.width = `${on.offsetWidth}px`;
  el.style.transform = `translateX(${on.offsetLeft}px)`;
  if (!placed.current) {
    void el.offsetWidth;
    el.style.transition = '';
    placed.current = true;
  }
}

function useSlider(box: RefObject<HTMLDivElement | null>): ReactNode {
  const ind = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  // every render: counts in the labels can change the widths
  useLayoutEffect(() => placeSlider(box.current, ind.current, placed));
  useEffect(() => {
    const f = () => placeSlider(box.current, ind.current, placed);
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(f); // e.g. when the font arrives
    if (box.current) ro?.observe(box.current);
    window.addEventListener('resize', f);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', f);
    };
  }, [box]);
  return <span ref={ind} className="slide-ind" aria-hidden="true" />;
}

/**
 * SPEC 5.0: the black header of every inner screen — back, actions, a big title, the screen's key
 * numbers, and white content rising over it. `cover` turns the block into the project's cover image.
 */
/** R-UI-1: true once the element has scrolled out of view at the top. */
function useScrolledPast<T extends Element>() {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPast(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, past] as const;
}

export function TopBar({ title, miniTitle, backTo, children, stats, sub, lead, cover }: { title: ReactNode; /** Text for the compact bar when `title` is an input. */ miniTitle?: string; backTo?: string | true; children?: ReactNode; stats?: HeadStat[]; sub?: ReactNode; lead?: ReactNode; cover?: string }) {
  const [sentinel, past] = useScrolledPast<HTMLDivElement>();
  const glass = useGlass();
  const goBack = () => back(typeof backTo === 'string' ? backTo : '/');
  return (
    <header className={`shead ${cover ? 'cover' : ''}`} style={cover ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.78)), url(${cover})` } : undefined}>
      {/* R-UI-1: compact bar once the header scrolls away; tapping it returns to the top. */}
      <div className={`shead-mini ${past ? 'on' : ''}`} aria-hidden={!past} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <div className="shead-mini-in">
          {backTo && (
            <button
              type="button"
              className="hbtn"
              tabIndex={past ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                goBack();
              }}
              aria-label="חזרה"
            >
              <Icon name="chevR" size="sm" />
            </button>
          )}
          <span className="grow ellipsis">{typeof title === 'string' ? title : miniTitle}</span>
        </div>
      </div>
      <div className="shead-bar">
        {backTo && (
          <button type="button" className="hbtn" onClick={goBack} aria-label="חזרה">
            <Icon name="chevR" />
          </button>
        )}
        <span className="grow" />
        {children}
      </div>
      <div className="shead-title">
        {lead}
        <div className="grow" style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="shead-sub">{sub}</div>}
        </div>
      </div>
      {stats && stats.length > 0 && (
        <div className="shead-stats">
          {stats.map((s, i) =>
            glass ? (
              <span key={i} className="gstat">
                {s.icon && (
                  <i className="sic">
                    <Icon name={s.icon} size="sm" />
                  </i>
                )}
                <span>
                  <b>{countify(s.v)}</b>
                  {s.k}
                </span>
              </span>
            ) : (
              <span key={i}>
                <b>{s.v}</b>
                {s.k}
              </span>
            ),
          )}
        </div>
      )}
      {/* R-UI-4: this week's number, outlined, behind the header */}
      <span className="wk" aria-hidden="true">
        {weekNumber(todayISO())}
      </span>
      <div ref={sentinel} className="shead-sentinel" />
    </header>
  );
}

/** R-UI-2: a long tab row scrolls, fades at the hidden edge, and keeps the active tab visible. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const glass = useGlass();
  const slider = useSlider(ref);
  const [fade, setFade] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scrolled = Math.abs(el.scrollLeft); // negative in RTL
    const rest = el.scrollWidth - el.clientWidth - scrolled;
    setFade((f) => (f.start === scrolled > 4 && f.end === rest > 4 ? f : { start: scrolled > 4, end: rest > 4 }));
  }, []);
  useEffect(() => {
    ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [value, items.length, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  return (
    <div
      ref={ref}
      className={`tabs ${fade.start ? 'fade-s' : ''} ${fade.end ? 'fade-e' : ''}`}
      role="tablist"
      onScroll={measure}
    >
      {glass && slider}
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// R-UI-5: a button that can't be pressed says why (red bubble) instead of doing nothing.
// aria-disabled, not disabled: a disabled button gets no tap, so it couldn't explain itself.
// The bubble is a fixed sibling (not a toast) so it also shows inside sheets.
// ---------------------------------------------------------------------------

interface Why {
  text: string;
  x: number;
  y: number;
  below: boolean;
  arrow: number;
}

export function Btn({ why, onClick, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { why?: string | false | null }) {
  const [msg, setMsg] = useState<Why | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <button
        type="button"
        {...rest}
        className={`${className ?? ''}${why ? ' off' : ''}`}
        aria-disabled={why ? true : undefined}
        onClick={(e) => {
          if (why) {
            e.preventDefault(); // also stops a form submit (Enter in a field clicks the submit button)
            const r = e.currentTarget.getBoundingClientRect();
            const mid = r.left + r.width / 2;
            const x = Math.min(Math.max(mid, 150), window.innerWidth - 150);
            const below = r.top < 80;
            clearTimeout(timer.current);
            setMsg({ text: why, x, y: below ? r.bottom + 10 : r.top - 10, below, arrow: mid - x });
            timer.current = setTimeout(() => setMsg(null), 3500);
            return;
          }
          onClick?.(e);
        }}
      >
        {children}
      </button>
      {msg && why && (
        <span className={`why${msg.below ? ' below' : ''}`} role="alert" style={{ left: msg.x, top: msg.y, ['--arrow' as string]: `${msg.arrow}px` }}>
          {msg.text}
        </span>
      )}
    </>
  );
}

export function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  const glass = useGlass();
  const box = useRef<HTMLDivElement>(null);
  const slider = useSlider(box);
  return (
    <div ref={box} className="seg">
      {glass && slider}
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

/** Empty state. `icon` is a line icon name; `emoji` only for happy moments (R-UI-3). */
export function Empty({ icon, emoji, children }: { icon?: string; emoji?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {emoji ? (
        <span className="big">{emoji}</span>
      ) : (
        icon && (
          <span className="big-ic">
            <Icon name={icon} />
          </span>
        )
      )}
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
