import { useState } from 'react';
import { addDays, formatLong, formatRelative, formatShort, HE_DAYS_SHORT, HE_MONTHS, parseISODate, toISODate, weekStart, localDate } from '../../domain/dates';
import type { Task } from '../../domain/schemas';
import { sprintStatus } from '../../domain/sprints';
import { compareForDay, isInbox, isOpen, quadrantOf, QUADRANT_LABEL, type Quadrant } from '../../domain/tasks';
import { occurrencesBetween } from '../../services/planning';
import { Q } from '../../services/queries';
import { deleteTask, restoreTasks, updateTask } from '../../services/tasks';
import { Empty, Tabs, TopBar, useToast } from '../components/common';
import { Icon } from '../components/Icon';
import { ProjectPicker, SprintPicker, TaskRow } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { go, replace } from '../router';

type Tab = 'inbox' | 'calendar' | 'projects' | 'matrix' | 'done';

export function TasksScreen({ tab = 'inbox' }: { tab?: string }) {
  const t = (['inbox', 'calendar', 'projects', 'matrix', 'done'].includes(tab) ? tab : 'inbox') as Tab;
  const tasks = useLive(Q.tasks) ?? [];
  const inboxCount = tasks.filter(isInbox).length;
  return (
    <div className="page">
      <TopBar title="משימות">
        <button type="button" className="iconbtn" aria-label="חיפוש" onClick={() => go('/search')}>
          <Icon name="search" />
        </button>
      </TopBar>
      <Tabs
        value={t}
        onChange={(v) => replace(`/tasks/${v}`)}
        items={[
          { id: 'inbox', label: 'דואר נכנס', count: inboxCount },
          { id: 'calendar', label: 'יומן' },
          { id: 'projects', label: 'לפי פרויקט' },
          { id: 'matrix', label: 'מטריצה' },
          { id: 'done', label: 'הושלמו' },
        ]}
      />
      {t === 'inbox' && <InboxTab tasks={tasks} />}
      {t === 'calendar' && <CalendarTab tasks={tasks} />}
      {t === 'projects' && <ByProjectTab tasks={tasks} />}
      {t === 'matrix' && <MatrixTab tasks={tasks} />}
      {t === 'done' && <DoneTab tasks={tasks} />}
    </div>
  );
}

/** SPEC 5.2 Clarify: each item gets a date, project or sprint, and leaves the inbox. */
function InboxTab({ tasks }: { tasks: Task[] }) {
  const { today } = useClock();
  const sprints = useLive(Q.sprints) ?? [];
  const toast = useToast();
  const [projectFor, setProjectFor] = useState<Task>();
  const [sprintFor, setSprintFor] = useState<Task>();
  const list = tasks.filter(isInbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cur = sprints.find((s) => sprintStatus(s, today) === 'current');
  if (!list.length) {
    return (
      <Empty icon="📭">
        הדואר הנכנס ריק.
        <br />
        כל מה שרושמים בכפתור + בלי תאריך, פרויקט או ספרינט מגיע לכאן לסידור.
      </Empty>
    );
  }
  return (
    <>
      <p className="muted small" style={{ margin: '0 4px 10px' }}>
        תן לכל פריט תאריך, פרויקט או ספרינט, והוא יעבור למקום שלו.
      </p>
      <section className="card">
        {list.map((t) => (
          <div key={t.id}>
            <TaskRow task={t} today={today} meta={`נרשם ${formatRelative(localDate(t.createdAt), today)}`} />
            <div className="chips tight" style={{ margin: '0 32px 10px 0' }}>
              <label className="chip out" style={{ position: 'relative' }}>
                <Icon name="cal" size="xs" /> תאריך
                <input type="date" aria-label="תאריך" style={{ position: 'absolute', inset: 0, opacity: 0 }} onChange={(e) => e.target.value && void updateTask(t.id, { dueDate: e.target.value })} />
              </label>
              <button type="button" className="chip out" onClick={() => void updateTask(t.id, { dueDate: today })}>
                היום
              </button>
              <button type="button" className="chip out" onClick={() => setProjectFor(t)}>
                <Icon name="folder" size="xs" /> פרויקט
              </button>
              {cur && (
                <button type="button" className="chip out" onClick={() => void updateTask(t.id, { sprintId: cur.id })}>
                  <Icon name="sprint" size="xs" /> לספרינט
                </button>
              )}
              <button type="button" className="chip out" onClick={() => setSprintFor(t)} aria-label="ספרינט אחר">
                …
              </button>
              <button
                type="button"
                className="chip out"
                aria-label="מחק"
                onClick={async () => {
                  const d = await deleteTask(t.id);
                  toast({ message: 'נמחק', action: { label: 'בטל', run: () => void restoreTasks(d) } });
                }}
              >
                <Icon name="trash" size="xs" />
              </button>
            </div>
          </div>
        ))}
      </section>
      <ProjectPicker open={!!projectFor} onClose={() => setProjectFor(undefined)} selected={projectFor?.projectIds ?? []} multi={false} onChange={(ids) => projectFor && void updateTask(projectFor.id, { projectIds: ids })} />
      <SprintPicker open={!!sprintFor} onClose={() => setSprintFor(undefined)} value={sprintFor?.sprintId} onChange={(id) => sprintFor && void updateTask(sprintFor.id, { sprintId: id })} />
    </>
  );
}

function CalendarTab({ tasks }: { tasks: Task[] }) {
  const { today } = useClock();
  const projects = useLive(Q.projects) ?? [];
  const recurring = useLive(Q.recurring) ?? [];
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(today);
  const first = `${month}-01`;
  const gridStart = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const lastDay = days[41]!;
  const future = occurrencesBetween(recurring, addDays(today, 1), lastDay);
  const has = (d: string) => tasks.some((t) => t.dueDate === d && t.status !== 'archived') || future.some((o) => o.date === d);
  const dayTasks = tasks.filter((t) => t.dueDate === sel && t.status !== 'archived' && !t.parentId).sort(compareForDay);
  const dayRecurring = future.filter((o) => o.date === sel);
  const m = parseISODate(first);
  const shift = (n: number) => {
    const d = parseISODate(first);
    d.setMonth(d.getMonth() + n);
    setMonth(toISODate(d).slice(0, 7));
  };
  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <button type="button" className="iconbtn topbar" style={{ margin: 0 }} aria-label="חודש קודם" onClick={() => shift(-1)}>
            <Icon name="chevR" />
          </button>
          <b>
            {HE_MONTHS[m.getMonth()]} {m.getFullYear()}
          </b>
          <button type="button" className="iconbtn topbar" style={{ margin: 0 }} aria-label="חודש הבא" onClick={() => shift(1)}>
            <Icon name="chev" />
          </button>
        </div>
        <div className="cal">
          {HE_DAYS_SHORT.map((d) => (
            <div key={d} className="dh">
              {d}
            </div>
          ))}
          {days.map((d) => (
            <button key={d} type="button" className={`${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)} aria-label={formatLong(d)}>
              {Number(d.slice(8))}
              <i className={has(d) ? '' : 'none'} />
            </button>
          ))}
        </div>
      </section>
      <div className="section-title">
        <span>{formatLong(sel)}</span>
        <button type="button" className="linkbtn" onClick={() => setSel(today)}>
          היום
        </button>
      </div>
      <section className="card">
        {dayTasks.map((t) => (
          <TaskRow key={t.id} task={t} projects={projects} />
        ))}
        {dayRecurring.map((o) => (
          <div key={o.recurringId} className="todo">
            <span className="box" style={{ borderStyle: 'dashed' }} />
            <button type="button" className="txt" onClick={() => go(`/recurring/${o.recurringId}`)}>
              {o.title}
              <span className="sub">
                <Icon name="repeat" size="xs" /> משימה חוזרת {o.startTime ? `· ${o.startTime}` : ''}
              </span>
            </button>
          </div>
        ))}
        {!dayTasks.length && !dayRecurring.length && <p className="muted small" style={{ margin: 4 }}>אין משימות ביום הזה.</p>}
      </section>
    </>
  );
}

function ByProjectTab({ tasks }: { tasks: Task[] }) {
  const projects = useLive(Q.projects) ?? [];
  const { today } = useClock();
  const open = tasks.filter((t) => isOpen(t) && !t.parentId);
  const groups = [
    ...projects
      .filter((p) => p.status !== 'archived')
      .map((p) => ({ key: p.id, name: `${p.icon} ${p.name}`, list: open.filter((t) => t.projectIds.includes(p.id)) }))
      .filter((g) => g.list.length),
    { key: 'none', name: 'בלי פרויקט', list: open.filter((t) => t.projectIds.length === 0) },
  ].filter((g) => g.list.length);
  if (!groups.length) return <Empty icon="✅">אין משימות פתוחות.</Empty>;
  return (
    <>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="section-title">
            <button type="button" onClick={() => g.key !== 'none' && go(`/project/${g.key}`)}>
              {g.name}
            </button>
            <span className="num">{g.list.length}</span>
          </div>
          <section className="card">
            {g.list.sort(compareForDay).map((t) => (
              <TaskRow key={t.id} task={t} today={today} />
            ))}
          </section>
        </div>
      ))}
    </>
  );
}

function MatrixTab({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => isOpen(t) && !t.parentId);
  const quads: Quadrant[] = ['do', 'plan', 'delegate', 'drop'];
  return (
    <>
      <p className="muted small" style={{ margin: '0 4px 10px' }}>
        משימות פתוחות לפי דחוף וחשוב. מסמנים את זה בתוך המשימה. "וותר" מציג רק משימות עם תאריך או בספרינט, כדי לא להציף.
      </p>
      <div className="matrix">
        {quads.map((q) => {
          let list = open.filter((t) => quadrantOf(t) === q);
          if (q === 'drop') list = list.filter((t) => t.dueDate || t.sprintId);
          return (
            <div key={q} className={`quad ${q}`}>
              <h5>{QUADRANT_LABEL[q].title}</h5>
              <div className="qs">
                {QUADRANT_LABEL[q].sub} · {list.length}
              </div>
              {list.slice(0, 12).map((t) => (
                <button key={t.id} type="button" className="qt" onClick={() => go(`/task/${t.id}`)}>
                  {t.title}
                </button>
              ))}
              {list.length > 12 && <div className="qs">ועוד {list.length - 12}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DoneTab({ tasks }: { tasks: Task[] }) {
  const projects = useLive(Q.projects) ?? [];
  const [limit, setLimit] = useState(50);
  const list = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  if (!list.length) return <Empty icon="🏁">עוד לא סיימת משימות. זה יגיע.</Empty>;
  return (
    <section className="card">
      {list.slice(0, limit).map((t) => (
        <TaskRow key={t.id} task={t} projects={projects} meta={t.completedAt ? `בוצעה ${formatShort(localDate(t.completedAt))}` : undefined} />
      ))}
      {list.length > limit && (
        <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 100)}>
          עוד
        </button>
      )}
    </section>
  );
}
