import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { formatDMY, formatRelative, localDate } from '../../domain/dates';
import type { Task, TaskStatus } from '../../domain/schemas';
import { completion, PRIORITY_LABEL, STATUS_LABEL } from '../../domain/tasks';
import { Q } from '../../services/queries';
import { setStatus } from '../../services/tasks';
import { reducedMotion } from '../design';
import { useClock, useLive } from '../hooks';
import { go } from '../router';
import { CountUp } from './common';
import { Icon } from './Icon';
import { projectName } from './tasks';

/** Glass look only: the sprint board's drag (R-SPR-6) and quick view (R-UI-13). */

const EASE = 'cubic-bezier(.22,1,.36,1)';
type Rects = Map<string, { x: number; y: number }>;

/** Rects of the board's cards, relative to the board (so scrolling between renders is not "movement"). */
function measure(box: HTMLElement): Rects {
  const o = box.getBoundingClientRect();
  const m: Rects = new Map();
  box.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
    const r = el.getBoundingClientRect();
    m.set(el.dataset.id!, { x: r.left - o.left, y: r.top - o.top });
  });
  return m;
}

/**
 * FLIP: after every render, cards that changed place glide from the old place to the new one.
 * `from` lets the drag hand over where the dropped card was let go.
 */
export function useFlip(box: RefObject<HTMLElement | null>, on: boolean) {
  const last = useRef<Rects>(new Map());
  const from = useRef<Rects>(new Map());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !on) return;
    const now = measure(el);
    if (!reducedMotion()) {
      el.querySelectorAll<HTMLElement>('[data-id]').forEach((card) => {
        const id = card.dataset.id!;
        const a = from.current.get(id) ?? last.current.get(id);
        const b = now.get(id);
        if (!a || !b || (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1)) return;
        card.animate([{ transform: `translate(${a.x - b.x}px,${a.y - b.y}px)` }, { transform: 'none' }], { duration: 520, easing: EASE });
      });
    }
    from.current = new Map();
    last.current = now;
  });
  return from;
}

interface Drag {
  id: string;
  card: HTMLElement;
  x0: number;
  y0: number;
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ghost?: HTMLElement;
  dx?: number;
  dy?: number;
  over?: HTMLElement;
}

/**
 * R-SPR-6: drag a card to another column. Mouse: starts after a 6px move. Touch: a long press (~0.3s),
 * so a normal swipe still scrolls. A copy of the card follows the finger; the column under it lights up.
 */
export function useBoardDrag(box: RefObject<HTMLElement | null>, flipFrom: RefObject<Rects>, onDrop: (id: string, to: TaskStatus) => void) {
  const drag = useRef<Drag | null>(null);
  const begin = useRef<(d: Drag, x: number, y: number) => void>(() => {});
  const drop = useRef(onDrop);
  useEffect(() => {
    drop.current = onDrop;
  });

  useEffect(() => {
    const cols = () => [...(box.current?.querySelectorAll<HTMLElement>('.col[data-s]') ?? [])];
    const start = (d: Drag, x: number, y: number) => {
      const r = d.card.getBoundingClientRect();
      const g = d.card.cloneNode(true) as HTMLElement;
      g.classList.add('kc-ghost');
      g.dataset.s = d.card.closest<HTMLElement>('.col[data-s]')?.dataset.s ?? ''; // keeps its colour outside the column
      Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
      document.body.appendChild(g);
      d.ghost = g;
      d.dx = x - r.left;
      d.dy = y - r.top;
      d.card.classList.add('kc-src');
      if (!reducedMotion()) g.animate([{ transform: 'none' }, { transform: 'rotate(-2.5deg) scale(1.04)' }], { duration: 240, easing: EASE, fill: 'forwards' });
    };
    begin.current = start;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (!d.ghost) {
        if (d.touch) {
          if (dist > 8) cancel(); // a swipe: let the page scroll
          return;
        }
        if (dist < 6) return;
        start(d, e.clientX, e.clientY);
      }
      d.ghost!.style.left = `${e.clientX - d.dx!}px`;
      d.ghost!.style.top = `${e.clientY - d.dy!}px`;
      const col = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest<HTMLElement>('.col[data-s]')).find((c) => c && box.current?.contains(c)) ?? undefined;
      cols().forEach((c) => c.classList.toggle('over', c === col));
      d.over = col;
    };
    const cancel = () => {
      const d = drag.current;
      if (!d) return;
      clearTimeout(d.timer);
      d.ghost?.remove();
      d.card.classList.remove('kc-src');
      cols().forEach((c) => c.classList.remove('over'));
      drag.current = null;
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      clearTimeout(d.timer);
      if (!d.ghost) {
        drag.current = null;
        return; // a plain tap: the card's own click handles it
      }
      // The tap that ends a drag must not also open the card.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 80);
      const to = d.over?.dataset.s as TaskStatus | undefined;
      const from = d.card.closest<HTMLElement>('.col[data-s]')?.dataset.s;
      if (to && to !== from && box.current) {
        const o = box.current.getBoundingClientRect();
        const g = d.ghost.getBoundingClientRect();
        flipFrom.current.set(d.id, { x: g.left - o.left, y: g.top - o.top });
        drop.current(d.id, to);
      } else if (!reducedMotion()) {
        const a = d.ghost.getBoundingClientRect();
        const b = d.card.getBoundingClientRect();
        d.card.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
      }
      cancel();
    };
    const touchMove = (e: TouchEvent) => {
      if (drag.current?.ghost) e.preventDefault(); // dragging: the page must not scroll
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      cancel();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
    };
  }, [box, flipFrom]);

  return (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button > 0 || (e.target as HTMLElement).closest('.mv')) return;
    const d: Drag = { id, card: e.currentTarget, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch' };
    if (d.touch) {
      // a long press lifts the card where the finger is
      d.timer = setTimeout(() => {
        if (drag.current !== d) return;
        begin.current(d, d.x0, d.y0);
        navigator.vibrate?.(10);
      }, 300);
    }
    drag.current = d;
  };
}

const FORWARD: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo', archived: 'todo' };

/**
 * R-UI-13: the card grows into a window (and shrinks back on close). The window's colour follows the
 * task's status, so moving it on changes the colour; "done" stamps it.
 */
export function QuickView({ task, from, onClose }: { task: Task; from: DOMRect; onClose: () => void }) {
  const { today } = useClock();
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const people = useLive(Q.people) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const live = tasks.find((x) => x.id === task.id) ?? task;
  const ref = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const subs = completion(tasks.filter((x) => x.parentId === task.id));
  const sprint = sprints.find((s) => s.id === live.sprintId);
  const waiting = people.find((p) => p.id === live.waitingPersonId);
  const stage = live.status === 'done' ? 2 : live.status === 'doing' ? 1 : 0;
  const next = FORWARD[live.status];

  // open: from the card's rect to the window's own
  useLayoutEffect(() => {
    const el = ref.current;
    document.querySelector(`.kanban [data-id="${task.id}"]`)?.classList.add('qv-src');
    if (!el || reducedMotion()) return;
    const b = el.getBoundingClientRect();
    el.animate(
      [
        { transform: `translate(${from.left - b.left}px,${from.top - b.top}px) scale(${from.width / b.width},${from.height / b.height})`, borderRadius: '20px' },
        { transform: 'none', borderRadius: '30px' },
      ],
      { duration: 560, easing: EASE },
    );
  }, [task.id, from]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const el = ref.current;
    const card = document.querySelector<HTMLElement>(`.kanban [data-id="${task.id}"]`);
    const done = () => {
      card?.classList.remove('qv-src');
      onClose();
    };
    if (!el || !card || reducedMotion()) return done();
    const a = card.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    document.querySelector('.qv-scrim')?.classList.add('out');
    el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width},${a.height / b.height})`, opacity: 0.5 },
      ],
      { duration: 440, easing: EASE, fill: 'forwards' },
    ).onfinish = done;
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <>
      <div className="qv-scrim" onClick={close} />
      <div ref={ref} className={`qv st-${live.status}`} role="dialog" aria-modal="true" aria-label={live.title}>
        <button type="button" className="qx" aria-label="סגור" onClick={close}>
          <Icon name="x" size="sm" />
        </button>
        <div className="qin">
          <div className="q-k" style={{ ['--q' as string]: 0 }}>
            <span className="num">#{live.seq}</span> · נוצרה {formatDMY(localDate(live.createdAt))}
          </div>
          <div className="q-t" style={{ ['--q' as string]: 1 }}>
            {live.title}
          </div>
          <div className="q-p" style={{ ['--q' as string]: 2 }}>
            {projectName(live.projectIds, projects) ?? 'בלי פרויקט'}
          </div>
          {subs.total > 0 ? (
            <div className="q-big" style={{ ['--q' as string]: 3 }}>
              <span className="ltr">
                <CountUp to={subs.done} />/{subs.total}
              </span>
              <small>תתי-משימות הושלמו</small>
            </div>
          ) : live.dueDate ? (
            <div className="q-big" style={{ ['--q' as string]: 3 }}>
              {formatRelative(live.dueDate, today)}
              <small>תאריך יעד</small>
            </div>
          ) : null}
          <div style={{ ['--q' as string]: 4 }}>
            <div className="stages">
              {[0, 1, 2].map((i) => (
                <i key={i} className={i <= stage ? 'on' : ''} />
              ))}
            </div>
            <div className="stlab">
              {(['todo', 'doing', 'done'] as const).map((s, i) => (
                <span key={s} className={i === stage ? 'on' : ''}>
                  {STATUS_LABEL[s]}
                </span>
              ))}
            </div>
          </div>
          <div className="q-panel" style={{ ['--q' as string]: 5 }}>
            <div>
              <small>תאריך יעד</small>
              <b>{live.dueDate ? formatDMY(live.dueDate) : '—'}</b>
            </div>
            <div>
              <small>עדיפות</small>
              <b>{live.priority ? PRIORITY_LABEL[live.priority] : '—'}</b>
            </div>
            <div>
              <small>ספרינט</small>
              <b>{sprint ? sprint.name.split(' · ')[0] : '—'}</b>
            </div>
          </div>
          {waiting && (
            <div className="q-note" style={{ ['--q' as string]: 6 }}>
              <Icon name="hourglass" size="sm" /> ממתין ל{waiting.name}
            </div>
          )}
          {live.body.trim() && (
            <div className="q-note" style={{ ['--q' as string]: 6 }}>
              <Icon name="note" size="sm" />
              <span className="ellipsis">{live.body.trim().split('\n')[0]}</span>
            </div>
          )}
          <div className="q-act" style={{ ['--q' as string]: 7 }}>
            <button type="button" className="q-o" onClick={() => go(`/task/${live.id}`)}>
              פתח משימה
            </button>
            <button type="button" className="q-go" onClick={() => void setStatus(live.id, next)}>
              {live.status === 'done' ? 'החזר ללעשות' : `העבר ל${STATUS_LABEL[next]}`} <Icon name="chev" size="xs" />
            </button>
          </div>
        </div>
        {live.status === 'done' && (
          <div className="stamp" aria-hidden="true">
            בוצע ✓
          </div>
        )}
      </div>
    </>
  );
}
