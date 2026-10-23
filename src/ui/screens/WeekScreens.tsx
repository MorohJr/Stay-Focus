import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { addDays, formatDMY, formatLong, formatShort, HE_DAYS, HE_DAYS_SHORT, hhmmOf, minutesOf } from '../../domain/dates';
import { occurrenceTime, REPEAT_LABEL } from '../../domain/events';
import { itemsOf } from '../../domain/routine';
import { DEFAULT_WORK, type CalEvent, type EventRepeat, type Task, type WorkOverride, type WorkSettings } from '../../domain/schemas';
import { findSprintFor, sprintName } from '../../domain/sprints';
import { DEFAULT_DURATION } from '../../domain/today';
import { dayPlan, isWorkTask, layoutLanes, snapMinutes, toSchedule, weekDays, workOverrideOf, type DayPlan, type PlanInput } from '../../domain/week';
import { deleteEvent, restoreEvent, saveEvent, saveWork, scheduleTask, unschedule } from '../../services/events';
import { Q } from '../../services/queries';
import { Btn, Empty, Seg, Switch, TopBar, useToast } from '../components/common';
import { Icon } from '../components/Icon';
import { ProjectPicker } from '../components/tasks';
import { reducedMotion } from '../design';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

/** SPEC 5.15: the Week screen — calendar and planning by work hours. */

const HOUR = 44; // px per hour in the grid
const pxOf = (min: number) => (min / 60) * HOUR;
const short = (min: number) => (min < 60 ? `${min} דק׳` : `${Number.isInteger(min / 60) ? min / 60 : (min / 60).toFixed(1)} ש׳`);

function useWide(): boolean {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return wide;
}

// ---------------------------------------------------------------------------
// R-WEK-5: drag a task to a slot. Mouse: after a 6px move. Touch: a long press (as R-SPR-6).
// ---------------------------------------------------------------------------

interface Drop {
  date: string;
  start: number;
}
interface SlotDrag {
  task: Task;
  dur: number;
  el: HTMLElement;
  x0: number;
  y0: number;
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ghost?: HTMLElement;
  /** where on the block the pointer holds it (minutes from its top) */
  grab: number;
  over?: Drop;
}

function dropAt(x: number, y: number, d: SlotDrag): Drop | undefined {
  const col = document.elementsFromPoint(x, y).map((n) => n.closest<HTMLElement>('.wk-day[data-date]')).find(Boolean);
  if (!col) return undefined;
  const r = col.getBoundingClientRect();
  return { date: col.dataset.date!, start: snapMinutes(((y - r.top) / HOUR) * 60 - d.grab, d.dur) };
}

function useSlotDrag(scroller: React.RefObject<HTMLElement | null>, onPreview: (p: (Drop & { dur: number }) | undefined) => void, onDrop: (task: Task, at: Drop, dur: number) => void) {
  const drag = useRef<SlotDrag | null>(null);
  const begin = useRef<(d: SlotDrag, x: number, y: number) => void>(() => {});
  const cb = useRef({ onPreview, onDrop });
  useEffect(() => {
    cb.current = { onPreview, onDrop };
  });
  useEffect(() => {
    const lift = (d: SlotDrag, x: number, y: number) => {
      const g = document.createElement('div');
      g.className = 'wk-ghost';
      g.textContent = d.task.title;
      document.body.appendChild(g);
      d.ghost = g;
      place(d, x, y);
      if (!reducedMotion()) g.animate([{ transform: 'scale(.9)' }, { transform: 'rotate(-2deg) scale(1)' }], { duration: 200, fill: 'forwards' });
      document.body.classList.add('wk-dragging');
    };
    begin.current = lift;
    const place = (d: SlotDrag, x: number, y: number) => {
      d.ghost!.style.left = `${x + 12}px`;
      d.ghost!.style.top = `${y - 16}px`;
      d.over = dropAt(x, y, d);
      cb.current.onPreview(d.over && { ...d.over, dur: d.dur });
      // near the grid's top or bottom edge: scroll it
      const sc = scroller.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (y < r.top + 40 && y > r.top - 60) sc.scrollTop -= 14;
        else if (y > r.bottom - 40 && y < r.bottom + 60) sc.scrollTop += 14;
      }
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (!d.ghost) {
        if (d.touch) {
          if (dist > 8) cancel(); // a swipe: let it scroll
          return;
        }
        if (dist < 6) return;
        lift(d, e.clientX, e.clientY);
      }
      place(d, e.clientX, e.clientY);
    };
    const cancel = () => {
      const d = drag.current;
      if (!d) return;
      clearTimeout(d.timer);
      d.ghost?.remove();
      document.body.classList.remove('wk-dragging');
      cb.current.onPreview(undefined);
      drag.current = null;
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      if (d.ghost) {
        // the click that ends a drag must not also select or open
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 80);
        if (d.over) cb.current.onDrop(d.task, d.over, d.dur);
      }
      cancel();
    };
    const touchMove = (e: TouchEvent) => {
      if (drag.current?.ghost) e.preventDefault();
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
  }, [scroller]);

  return (e: React.PointerEvent<HTMLElement>, task: Task, grab = 0) => {
    if (e.button > 0) return;
    const d: SlotDrag = { task, dur: task.durationMin ?? DEFAULT_DURATION, el: e.currentTarget, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch', grab };
    if (d.touch) {
      // a long press lifts it where the finger is
      d.timer = setTimeout(() => {
        if (drag.current !== d) return;
        begin.current(d, d.x0, d.y0);
        navigator.vibrate?.(10);
      }, 300);
    }
    drag.current = d;
  };
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function WeekScreen({ date }: { date?: string }) {
  const { today, nowMin } = useClock();
  const wide = useWide();
  const tasks = useLive(Q.tasks);
  const events = useLive(Q.events) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const areas = useLive(Q.areas) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const settings = useLive(Q.settings);
  const routineItems = useLive(Q.routineItems) ?? [];
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [preview, setPreview] = useState<(Drop & { dur: number }) | undefined>();
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const days = weekDays(anchor);
  const shown = wide ? days : [anchor];

  const doSchedule = async (task: Task, at: Drop, dur: number) => {
    setSelected(undefined);
    const before = await scheduleTask(task.id, at.date, hhmmOf(at.start), dur);
    if (!before) return;
    toast({ message: `שובץ: ${HE_DAYS[new Date(`${at.date}T12:00`).getDay()]} ${hhmmOf(at.start)}`, action: { label: 'בטל', run: () => void unschedule(task.id, before) } });
  };
  const startDrag = useSlotDrag(scroller, setPreview, (t, at, dur) => void doSchedule(t, at, dur));

  // R-WEK-1: open at wake time (the earliest of the days shown)
  const wakeMin = settings ? minutesOf(settings.routines.morningStart) : 6 * 60;
  const loaded = !!tasks && !!settings;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = pxOf(Math.max(0, wakeMin - 30));
  }, [wakeMin, wide, loaded]);

  // Phone: swipe between days
  const swipe = useRef<{ x: number; y: number } | null>(null);

  if (!tasks || !settings) return <div className="page week" />;
  const input: PlanInput = {
    today,
    nowMin,
    routines: settings.routines,
    hasRoutineItems: { morning: itemsOf(routineItems, 'morning').length > 0, evening: itemsOf(routineItems, 'evening').length > 0 },
    work: settings.work,
    tasks,
    events,
    projects,
    areas,
  };
  const plans = shown.map((d) => dayPlan(d, input));
  const weekPlans = wide ? plans : days.map((d) => dayPlan(d, input));
  const sprint = findSprintFor(sprints, days[0]!);
  const list = toSchedule(tasks, sprint?.id);
  const sel = list.find((t) => t.id === selected) ?? tasks.find((t) => t.id === selected);
  const freeWork = weekPlans.reduce((a, p) => a + (p.free?.work ?? 0), 0);
  const eventCount = weekPlans.reduce((a, p) => a + p.events.length + p.allDay.length, 0);
  const step = (n: number) => replace(`/week/${addDays(anchor, wide ? n * 7 : n)}`);

  const tapSlot = (e: React.MouseEvent<HTMLElement>, day: string) => {
    if ((e.target as HTMLElement).closest('.wk-b')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = Math.floor((((e.clientY - r.top) / HOUR) * 60) / 15) * 15;
    if (sel) void doSchedule(sel, { date: day, start: snapMinutes(min, sel.durationMin ?? DEFAULT_DURATION) }, sel.durationMin ?? DEFAULT_DURATION);
    else go(`/event/new/${day}/${hhmmOf(min)}`);
  };

  return (
    <div className="page week">
      <TopBar
        title="שבוע"
        more
        sub={sprintName(days[0]!)}
        stats={[
          { v: eventCount, k: 'ביומן', icon: 'cal' },
          { v: list.length, k: 'לשבץ', icon: 'sprint' },
          { v: short(freeWork), k: 'פנוי בעבודה', icon: 'clock' },
        ]}
      >
        <button type="button" className="hbtn" aria-label="שעות עבודה" onClick={() => go('/work-hours')}>
          <Icon name="clock" />
        </button>
        <button type="button" className="hbtn" aria-label="אירוע חדש" onClick={() => go(`/event/new/${anchor}`)}>
          <Icon name="plus" />
        </button>
      </TopBar>

      {/* R-WEK-1: move between days (phone) or weeks (desktop) */}
      <div className="wk-nav">
        <button type="button" className="iconbtn" aria-label={wide ? 'השבוע הקודם' : 'היום הקודם'} onClick={() => step(-1)}>
          <Icon name="chevR" />
        </button>
        {wide ? (
          <b className="grow">{sprintName(days[0]!)}</b>
        ) : (
          <div className="wk-days grow">
            {days.map((d, i) => (
              <button key={d} type="button" className={`${d === anchor ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => replace(`/week/${d}`)}>
                <small>{HE_DAYS_SHORT[i]}</small>
                <span className="num">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="iconbtn" aria-label={wide ? 'השבוע הבא' : 'היום הבא'} onClick={() => step(1)}>
          <Icon name="chev" />
        </button>
        {(wide ? !days.includes(today) : anchor !== today) ? (
          <button type="button" className="minibtn" onClick={() => replace(`/week/${today}`)}>
            היום
          </button>
        ) : null}
      </div>

      <div className="wk-layout">
        {/* R-WEK-4: what is left to place */}
        <section className="wk-todo card" aria-label="לשבץ">
          <h4>
            <span className="t">
              <Icon name="sprint" size="sm" /> לשבץ
            </span>
            <small>{sel ? 'בחר מקום ברשת' : wide ? 'גרור לשעה פנויה' : 'לחיצה ארוכה וגרירה, או לחיצה ואז מקום'}</small>
          </h4>
          {!list.length && <p className="muted small" style={{ margin: 0 }}>{sprint ? 'כל המשימות של הספרינט משובצות או סגורות.' : 'אין ספרינט לשבוע הזה.'}</p>}
          <div className="wk-chips">
            {list.map((t) => {
              const work = isWorkTask(t, projects, areas);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`wk-chip ${selected === t.id ? 'sel' : ''}`}
                  onPointerDown={(e) => startDrag(e, t)}
                  onClick={() => setSelected(selected === t.id ? undefined : t.id)}
                  aria-pressed={selected === t.id}
                >
                  <span className="gt">{t.title}</span>
                  <small>
                    <i className={work ? 'w' : 'p'} />
                    {work ? 'עבודה' : 'אישי'} · {short(t.durationMin ?? DEFAULT_DURATION)}
                  </small>
                </button>
              );
            })}
          </div>
          {sel && (
            <button type="button" className="minibtn" style={{ marginTop: 8 }} onClick={() => setSelected(undefined)}>
              ביטול הבחירה
            </button>
          )}
        </section>

        <div className="wk-cal card">
          <div className="wk-head" style={{ '--n': shown.length } as CSSProperties}>
            <span />
            {plans.map((p) => (
              <DayHead key={p.date} plan={p} today={today} wide={wide} work={settings.work} />
            ))}
          </div>
          <div
            className="wk-scroll"
            ref={scroller}
            onTouchStart={(e) => {
              const t = e.touches[0]!;
              swipe.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s || wide || document.body.classList.contains('wk-dragging')) return;
              const t = e.changedTouches[0]!;
              const dx = t.clientX - s.x;
              if (Math.abs(dx) > 70 && Math.abs(t.clientY - s.y) < 40) step(dx > 0 ? 1 : -1); // RTL: swipe right = next day
            }}
          >
            <div className="wk-grid" style={{ '--n': shown.length, height: pxOf(24 * 60) } as CSSProperties}>
              <div className="wk-hours" aria-hidden="true">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} style={{ top: pxOf(h * 60) }}>
                    {h ? `${h}:00` : ''}
                  </span>
                ))}
              </div>
              {plans.map((p) => (
                <DayColumn key={p.date} plan={p} today={today} nowMin={nowMin} preview={preview?.date === p.date ? preview : undefined} picking={!!sel} onTap={(e) => tapSlot(e, p.date)} onDragTask={startDrag} />
              ))}
            </div>
          </div>
          <div className="lg wk-lg">
            <span>
              <i className="lg-work" />
              שעות עבודה
            </span>
            <span>
              <i className="lg-sleep" />
              שינה
            </span>
            <span>
              <i className="lg-rtn" />
              שגרה
            </span>
            <span>
              <i style={{ background: 'var(--blue)' }} />
              יומן
            </span>
            <span>
              <i style={{ background: 'var(--ink)' }} />
              משימות
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayHead({ plan: p, today, wide, work }: { plan: DayPlan; today: string; wide: boolean; work: WorkSettings | undefined }) {
  const o = workOverrideOf(work, p.date);
  const dow = new Date(`${p.date}T12:00`).getDay();
  return (
    <div className={`wk-dh ${p.date === today ? 'today' : ''}`}>
      <b>{wide ? `${HE_DAYS[dow]} ${formatShort(p.date)}` : formatLong(p.date)}</b>
      <small>{p.work ? `עבודה ${hhmmOf(p.work.start)}–${hhmmOf(p.work.end)}` : 'בלי עבודה'}{o?.note ? ` · ${o.note}` : ''}</small>
      {/* R-WEK-6 */}
      {p.free && (
        <small>
          פנוי: {p.work ? <>בעבודה <b className="num">{short(p.free.work)}</b> · </> : null}מחוץ <b className="num">{short(p.free.other)}</b>
        </small>
      )}
      {/* R-WEK-7 */}
      {(p.scheduled.work > 0 || p.scheduled.personal > 0) && (
        <small>
          משובץ: עבודה {short(p.scheduled.work)} · אישי {short(p.scheduled.personal)}
        </small>
      )}
      {p.allDay.map((o2) => (
        <button key={o2.event.id} type="button" className="wk-allday" onClick={() => go(`/event/${o2.event.id}`)}>
          {o2.event.title}
        </button>
      ))}
    </div>
  );
}

function DayColumn({ plan: p, today, nowMin, preview, picking, onTap, onDragTask }: { plan: DayPlan; today: string; nowMin: number; preview?: Drop & { dur: number }; picking: boolean; onTap: (e: React.MouseEvent<HTMLElement>) => void; onDragTask: (e: React.PointerEvent<HTMLElement>, t: Task, grab?: number) => void }) {
  const lanes = layoutLanes([...p.events.map((o) => ({ id: `e:${o.event.id}`, start: o.start, end: o.end })), ...p.tasks.map((t) => ({ id: `t:${t.task.id}`, start: t.start, end: t.end }))]);
  const box = (id: string, start: number, end: number): CSSProperties => {
    const l = lanes.get(id) ?? { lane: 0, lanes: 1 };
    return { top: pxOf(start), height: Math.max(16, pxOf(end - start) - 2), right: `calc(${(l.lane / l.lanes) * 100}% + 2px)`, width: `calc(${100 / l.lanes}% - 4px)` };
  };
  return (
    <div className={`wk-day ${p.date === today ? 'today' : ''} ${picking ? 'picking' : ''}`} data-date={p.date} onClick={onTap}>
      {p.work && <i className="wk-bg wk-work" style={{ top: pxOf(p.work.start), height: pxOf(p.work.end - p.work.start) }} />}
      {p.routines.map((r, i) => (
        <i key={`r${i}`} className="wk-bg wk-rtn" style={{ top: pxOf(r.start), height: pxOf(Math.min(r.end, 24 * 60) - r.start) }} />
      ))}
      {p.sleep.map((r, i) => (
        <i key={`s${i}`} className="wk-bg wk-sleep" style={{ top: pxOf(r.start), height: pxOf(r.end - r.start) }} />
      ))}
      {p.events.map((o) => (
        <button key={o.event.id} type="button" title={`${o.event.title} ${occurrenceTime(o)}`} className={`wk-b wk-ev ${o.end - o.start < 45 ? 'short' : ''}`} style={box(`e:${o.event.id}`, o.start, o.end)} onClick={() => go(`/event/${o.event.id}`)}>
          <b className="gt">{o.event.title}</b>
          <small className="ltr num">{occurrenceTime(o)}</small>
        </button>
      ))}
      {p.tasks.map(({ task, start, end }) => (
        <button
          key={task.id}
          type="button"
          title={`${task.title} ${hhmmOf(start)}–${hhmmOf(end)}`}
          className={`wk-b wk-tk ${task.status === 'done' ? 'done' : ''} ${end - start < 45 ? 'short' : ''}`}
          style={box(`t:${task.id}`, start, end)}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onDragTask(e, task, ((e.clientY - r.top) / HOUR) * 60);
          }}
          onClick={() => go(`/task/${task.id}`)}
        >
          <b className="gt">{task.title}</b>
          <small className="ltr num">
            {hhmmOf(start)}–{hhmmOf(end)}
          </small>
        </button>
      ))}
      {preview && <i className="wk-preview" style={{ top: pxOf(preview.start), height: pxOf(preview.dur) }} data-t={hhmmOf(preview.start)} />}
      {p.date === today && <i className="wk-now" style={{ top: pxOf(nowMin) }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event (R-EVT-4)
// ---------------------------------------------------------------------------

/** /event/<id> or /event/new/<date>[/<HH:mm>] */
export function EventScreen({ id, date, time }: { id: string; date?: string; time?: string }) {
  const isNew = id === 'new';
  const existing = useLive(() => (isNew ? Promise.resolve(null) : Q.event(id)), [id]);
  const { today } = useClock();
  if (!isNew && existing === undefined) return <div className="page sub" />;
  if (!isNew && existing === null) {
    return (
      <div className="page sub">
        <TopBar title="אירוע" backTo="/week" />
        <Empty icon="search">האירוע לא נמצא.</Empty>
      </div>
    );
  }
  return <EventForm key={existing?.id ?? `new-${date}-${time}`} existing={existing ?? undefined} date={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today} time={time && /^\d{2}:\d{2}$/.test(time) ? time : undefined} />;
}

function EventForm({ existing, date: date0, time }: { existing?: CalEvent; date: string; time?: string }) {
  const projects = useLive(Q.projects) ?? [];
  const people = useLive(Q.people) ?? [];
  const toast = useToast();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.date ?? date0);
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing?.startTime ?? time ?? '09:00');
  const [end, setEnd] = useState(existing?.endTime ?? hhmmOf(Math.min(minutesOf(time ?? '09:00') + 60, 23 * 60 + 59)));
  const [repeat, setRepeat] = useState<EventRepeat>(existing?.repeat ?? 'none');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [projectId, setProjectId] = useState(existing?.projectId);
  const [personId, setPersonId] = useState(existing?.personId);
  const [pick, setPick] = useState(false);
  const badTime = !allDay && minutesOf(end) <= minutesOf(start);
  const save = async () => {
    if (!title.trim() || badTime) return;
    await saveEvent({ id: existing?.id, title: title.trim(), date, allDay, startTime: allDay ? undefined : start, endTime: allDay ? undefined : end, repeat, location: location.trim(), body, projectId, personId });
    back('/week');
  };
  const project = projects.find((p) => p.id === projectId);
  return (
    <div className="page sub">
      <TopBar title={existing ? 'אירוע' : 'אירוע חדש'} backTo="/week">
        {existing && (
          <button
            type="button"
            className="iconbtn"
            aria-label="מחק"
            onClick={async () => {
              const gone = await deleteEvent(existing.id);
              back('/week');
              if (gone) toast({ message: 'האירוע נמחק', action: { label: 'בטל', run: () => void restoreEvent(gone) } });
            }}
          >
            <Icon name="trash" />
          </button>
        )}
      </TopBar>
      <input className="title-input" placeholder="למשל: פגישה עם דנה" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!existing} />
      <section className="card" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="ed">תאריך</label>
          <input id="ed" type="date" className="mini-input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div className="field">
          <span className="lab">כל היום</span>
          <Switch label="כל היום" on={allDay} onChange={setAllDay} />
        </div>
        {!allDay && (
          <div className="field">
            <label htmlFor="es">שעות</label>
            <span className="val">
              <input id="es" type="time" className="mini-input ltr" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
              <span>עד</span>
              <input type="time" aria-label="שעת סיום" className="mini-input ltr" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
            </span>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <Seg value={repeat} onChange={setRepeat} items={(['none', 'weekly', 'monthly', 'yearly'] as const).map((r) => ({ id: r, label: REPEAT_LABEL[r] }))} />
        </div>
      </section>
      <section className="card">
        <div className="field">
          <label htmlFor="el">מיקום</label>
          <input id="el" className="mini-input" placeholder="לא חובה" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <span className="lab">פרויקט</span>
          <button type="button" className="val linkbtn" onClick={() => setPick(true)}>
            {project ? `${project.icon} ${project.name}` : 'בחר'}
          </button>
        </div>
        <div className="field">
          <label htmlFor="ep">אדם</label>
          <select id="ep" className="mini-input" value={personId ?? ''} onChange={(e) => setPersonId(e.target.value || undefined)}>
            <option value="">בלי</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name}
              </option>
            ))}
          </select>
        </div>
      </section>
      <textarea className="textarea" rows={4} placeholder="הערה" value={body} onChange={(e) => setBody(e.target.value)} style={{ marginBottom: 12 }} />
      <Btn type="button" className="btn primary block" why={!title.trim() ? 'צריך לכתוב שם לאירוע' : badTime && 'שעת הסיום צריכה להיות אחרי ההתחלה'} onClick={() => void save()}>
        שמור
      </Btn>
      <ProjectPicker open={pick} onClose={() => setPick(false)} multi={false} selected={projectId ? [projectId] : []} onChange={(ids) => setProjectId(ids[0])} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work hours (R-WRK-3)
// ---------------------------------------------------------------------------

export function WorkHoursScreen() {
  const settings = useLive(Q.settings);
  const { today } = useClock();
  const [od, setOd] = useState(today);
  const [off, setOff] = useState<'off' | 'hours'>('off');
  const [os, setOs] = useState('09:00');
  const [oe, setOe] = useState('13:00');
  const [note, setNote] = useState('');
  if (!settings) return <div className="page sub" />;
  const work = settings.work ?? DEFAULT_WORK;
  const set = (patch: Partial<WorkSettings>) => void saveWork({ ...work, ...patch });
  const setDay = (i: number, v: WorkSettings['days'][number]) => set({ days: work.days.map((d, j) => (j === i ? v : d)) });
  const visible = work.overrides.filter((o) => o.date >= addDays(today, -30)).sort((a, b) => a.date.localeCompare(b.date));
  const addOverride = () => {
    if (off === 'hours' && minutesOf(oe) <= minutesOf(os)) return;
    const o: WorkOverride = { date: od, off: off === 'off', start: off === 'off' ? undefined : os, end: off === 'off' ? undefined : oe, note: note.trim() };
    set({ overrides: [...work.overrides.filter((x) => x.date !== od), o] });
    setNote('');
  };
  return (
    <div className="page sub">
      <TopBar title="שעות עבודה" backTo="/week" />
      <p className="muted small" style={{ margin: '0 4px 10px' }}>
        המסך "שבוע" מראה את שעות העבודה ברקע, וכמה זמן פנוי נשאר בעבודה ומחוץ לה. משימה נחשבת "עבודה" לפי התחום של הפרויקט שלה (במסך התחומים).
      </p>
      <section className="card">
        {HE_DAYS.map((d, i) => {
          const v = work.days[i];
          return (
            <div key={d} className="field">
              <span className="row" style={{ gap: 10 }}>
                <Switch label={`עובד ביום ${d}`} on={!!v} onChange={(on) => setDay(i, on ? { start: '09:00', end: '18:00' } : null)} />
                <span className="lab">{d}</span>
              </span>
              {v ? (
                <span className="val">
                  <input type="time" aria-label={`התחלה ביום ${d}`} className="mini-input ltr" value={v.start} onChange={(e) => e.target.value && minutesOf(e.target.value) < minutesOf(v.end) && setDay(i, { ...v, start: e.target.value })} />
                  <span>עד</span>
                  <input type="time" aria-label={`סיום ביום ${d}`} className="mini-input ltr" value={v.end} onChange={(e) => e.target.value && minutesOf(e.target.value) > minutesOf(v.start) && setDay(i, { ...v, end: e.target.value })} />
                </span>
              ) : (
                <span className="muted small">לא עובד</span>
              )}
            </div>
          );
        })}
      </section>
      <div className="section-title">ימים מיוחדים</div>
      <section className="card">
        {visible.map((o) => (
          <div key={o.date} className="field">
            <span className="grow">
              <b className="num">{formatDMY(o.date)}</b> · {o.off ? 'חופש' : <span className="ltr num">{o.start}–{o.end}</span>}
              {o.note && <span className="muted"> · {o.note}</span>}
            </span>
            <button type="button" className="muted" aria-label="מחק" onClick={() => set({ overrides: work.overrides.filter((x) => x.date !== o.date) })}>
              <Icon name="trash" size="sm" />
            </button>
          </div>
        ))}
        {!visible.length && <p className="muted small" style={{ margin: '0 0 8px' }}>חופשה, יום קצר או יום ארוך: מוסיפים כאן תאריך.</p>}
        <div className="field">
          <label htmlFor="wo-d">תאריך</label>
          <input id="wo-d" type="date" className="mini-input" value={od} onChange={(e) => e.target.value && setOd(e.target.value)} />
        </div>
        <div style={{ margin: '8px 0' }}>
          <Seg value={off} onChange={setOff} items={[{ id: 'off', label: 'חופש' }, { id: 'hours', label: 'שעות אחרות' }]} />
        </div>
        {off === 'hours' && (
          <div className="field">
            <label htmlFor="wo-s">שעות</label>
            <span className="val">
              <input id="wo-s" type="time" className="mini-input ltr" value={os} onChange={(e) => e.target.value && setOs(e.target.value)} />
              <span>עד</span>
              <input type="time" aria-label="סיום" className="mini-input ltr" value={oe} onChange={(e) => e.target.value && setOe(e.target.value)} />
            </span>
          </div>
        )}
        <div className="field">
          <label htmlFor="wo-n">הערה</label>
          <input id="wo-n" className="mini-input" placeholder="למשל: חופשה" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Btn type="button" className="btn block" why={off === 'hours' && minutesOf(oe) <= minutesOf(os) && 'שעת הסיום צריכה להיות אחרי ההתחלה'} onClick={addOverride}>
          <Icon name="plus" size="sm" /> הוסף יום מיוחד
        </Btn>
      </section>
    </div>
  );
}
