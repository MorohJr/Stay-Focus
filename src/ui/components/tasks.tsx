import { useState, type ReactNode } from 'react';
import { addDays, formatRelative, formatShort } from '../../domain/dates';
import type { Project, Sprint, Task } from '../../domain/schemas';
import { sprintStatus, SPRINT_STATUS_LABEL } from '../../domain/sprints';
import { isActiveOpen, isOpen, isStuck } from '../../domain/tasks';
import { createNote } from '../../services/planning';
import { Q } from '../../services/queries';
import { createTask, postponeTask, toggleDone, type Postpone } from '../../services/tasks';
import { useClock, useLive } from '../hooks';
import { go } from '../router';
import { Seg, Sheet, useToast } from './common';
import { Icon } from './Icon';
import { ProjectIcon } from './ProjectIcon';

export function Box({ status, onClick, label }: { status: Task['status']; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`box ${status === 'done' ? 'checked' : status === 'doing' ? 'doing' : ''}`}
      aria-label={label}
      aria-pressed={status === 'done'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {status === 'done' && <Icon name="check" />}
    </button>
  );
}

export function projectName(ids: string[], projects: Project[] | undefined): string | undefined {
  const p = projects?.find((x) => ids.includes(x.id));
  if (!p) return undefined;
  return ids.length > 1 ? `${p.name} +${ids.length - 1}` : p.name;
}

/** A task line: circle to complete, title opens the task. */
export function TaskRow({ task, projects, today, meta, end }: { task: Task; projects?: Project[]; today?: string; meta?: ReactNode; end?: ReactNode }) {
  const proj = projectName(task.projectIds, projects);
  const bits: string[] = [];
  if (task.dueDate && today) bits.push(formatRelative(task.dueDate, today));
  if (task.startTime) bits.push(task.startTime);
  if (proj) bits.push(proj);
  if (task.attachmentIds.length) bits.push('📷');
  if (task.links.length) bits.push('🔗');
  // SPEC 5.0: a dense row — #id, status icon, one-line title, small meta.
  return (
    <div className={`drow ${task.status}`}>
      <span className="id num">#{task.seq}</span>
      <StatusDot status={task.status} onClick={() => void toggleDone(task.id)} label={`סמן ${task.title}`} />
      <button type="button" className="t" onClick={() => go(`/task/${task.id}`)}>
        <span className="tt">{task.title || 'ללא שם'}</span>
        {isStuck(task) && <span className="badge" title={`נדחתה ${task.postponeCount} פעמים`}>🐢{task.postponeCount}</span>}
        {task.waitingPersonId && isOpen(task) && <WaitingBadge personId={task.waitingPersonId} />}
        {(meta ?? bits.length > 0) && <span className="m">{meta ?? bits.join(' · ')}</span>}
      </button>
      {end}
    </div>
  );
}

/** R-WAI: "⏳ <שם>" */
function WaitingBadge({ personId }: { personId: string }) {
  const p = useLive(() => Q.person(personId), [personId]);
  if (!p) return null;
  return <span className="badge blue">⏳ {p.name}</span>;
}

/** Small status icon for dense rows: empty, half (doing), check (done), recycle (archived). Tap toggles done. */
export function StatusDot({ status, onClick, label }: { status: Task['status']; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`sdot ${status}`}
      aria-label={label}
      aria-pressed={status === 'done'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {status === 'done' && <Icon name="check" />}
      {status === 'archived' && '♲'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export function ProjectPicker({ open, onClose, selected, onChange, multi = true }: { open: boolean; onClose: () => void; selected: string[]; onChange: (ids: string[]) => void; multi?: boolean }) {
  const projects = useLive(Q.projects) ?? [];
  const list = projects.filter((p) => p.status !== 'archived' || selected.includes(p.id)).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.name.localeCompare(b.name, 'he'));
  return (
    <Sheet open={open} onClose={onClose} title="פרויקט">
      {list.length === 0 && <p className="muted">אין עדיין פרויקטים. אפשר ליצור בלשונית "פרויקטים".</p>}
      {list.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="opt"
            onClick={() => {
              if (multi) onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id]);
              else {
                onChange(on ? [] : [p.id]);
                onClose();
              }
            }}
          >
            <ProjectIcon project={p} size={28} radius={8} />
            <span className="grow">{p.name}</span>
            {on && <span className="check"><Icon name="check" /></span>}
          </button>
        );
      })}
      {multi && (
        <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={onClose}>
          סיום
        </button>
      )}
    </Sheet>
  );
}

export function SprintPicker({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value?: string; onChange: (id: string | undefined) => void }) {
  const sprints = useLive(Q.sprints) ?? [];
  const { today } = useClock();
  const list = sprints.filter((s) => ['current', 'next', 'future'].includes(sprintStatus(s, today)) || s.id === value);
  const pick = (id: string | undefined) => {
    onChange(id);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="ספרינט">
      <button type="button" className="opt" onClick={() => pick(undefined)}>
        <span className="grow">בלי ספרינט (בקלוג)</span>
        {!value && <span className="check"><Icon name="check" /></span>}
      </button>
      {list.map((s: Sprint) => (
        <button key={s.id} type="button" className="opt" onClick={() => pick(s.id)}>
          <span className="grow">{s.name}</span>
          <span className="tag g">{SPRINT_STATUS_LABEL[sprintStatus(s, today)]}</span>
          {value === s.id && <span className="check"><Icon name="check" /></span>}
        </button>
      ))}
    </Sheet>
  );
}

/** "דחה" options (R-TOD-2). */
export function PostponeSheet({ task, onClose }: { task: Task | undefined; onClose: () => void }) {
  const { today } = useClock();
  const [custom, setCustom] = useState('');
  const run = async (how: Postpone) => {
    if (task) await postponeTask(task.id, how, today);
    onClose();
  };
  return (
    <Sheet open={!!task} onClose={onClose} title="לדחות ל…">
      {task?.startTime && (
        <>
          <button type="button" className="opt" onClick={() => void run('plus30')}>
            <Icon name="clock" /> עוד 30 דק׳
          </button>
          <button type="button" className="opt" onClick={() => void run('plus60')}>
            <Icon name="clock" /> עוד שעה
          </button>
        </>
      )}
      <button type="button" className="opt" onClick={() => void run('tomorrow')}>
        <Icon name="sunrise" /> מחר <span className="muted small">{formatShort(addDays(today, 1))}</span>
      </button>
      <div className="opt">
        <Icon name="cal" />
        <input type="date" className="mini-input grow" value={custom} min={today} onChange={(e) => setCustom(e.target.value)} aria-label="תאריך" />
        <button type="button" className="minibtn dark" disabled={!custom} onClick={() => custom && void run({ date: custom })}>
          דחה
        </button>
      </div>
    </Sheet>
  );
}

/** Choose a task for a top-3 slot: today's, this sprint's, then the inbox. */
export function TaskPickerSheet({ open, onClose, onPick, exclude, title }: { open: boolean; onClose: () => void; onPick: (t: Task) => void; exclude: string[]; title: string }) {
  const tasks = useLive(Q.tasks) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const { today } = useClock();
  const [q, setQ] = useState('');
  const groups = (() => {
    const cur = sprints.find((s) => sprintStatus(s, today) === 'current');
    const pool = tasks.filter((t) => isActiveOpen(t) && !t.parentId && !exclude.includes(t.id) && (!q || t.title.toLowerCase().includes(q.toLowerCase())));
    const seen = new Set<string>();
    const take = (f: (t: Task) => boolean) => pool.filter((t) => !seen.has(t.id) && f(t)).map((t) => (seen.add(t.id), t));
    return [
      { name: 'להיום ובאיחור', list: take((t) => !!t.dueDate && t.dueDate <= today) },
      { name: 'בספרינט הנוכחי', list: take((t) => !!cur && t.sprintId === cur.id) },
      { name: 'עוד משימות', list: take(() => true).slice(0, 40) },
    ].filter((g) => g.list.length);
  })();
  const [newTitle, setNewTitle] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="addrow" style={{ marginTop: 0, marginBottom: 8 }}>
        <input className="input" placeholder="משימה חדשה…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <button
          type="button"
          className="btn primary"
          disabled={!newTitle.trim()}
          onClick={async () => {
            const t = await createTask({ title: newTitle, dueDate: today });
            setNewTitle('');
            onPick(t);
          }}
        >
          הוסף
        </button>
      </div>
      <input className="input" placeholder="חיפוש…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
      {groups.map((g) => (
        <div key={g.name}>
          <div className="section-title">{g.name}</div>
          {g.list.map((t) => (
            <button key={t.id} type="button" className="opt" onClick={() => onPick(t)}>
              <span className="grow">{t.title}</span>
              {t.dueDate && <span className="tag g">{formatRelative(t.dueDate, today)}</span>}
            </button>
          ))}
        </div>
      ))}
      {groups.length === 0 && <p className="muted">אין משימות פתוחות. אפשר להוסיף חדשה למעלה.</p>}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Quick capture (SPEC 5.1)
// ---------------------------------------------------------------------------

export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'task' | 'note'>('task');
  const [forToday, setForToday] = useState(false);
  const [forSprint, setForSprint] = useState(false);
  const { today } = useClock();
  const sprints = useLive(Q.sprints) ?? [];
  const toast = useToast();
  const save = async () => {
    const title = text.trim();
    if (!title) return;
    if (kind === 'note') {
      const n = await createNote({ title });
      toast({ message: 'הפתק נשמר', action: { label: 'פתח', run: () => go(`/note/${n.id}`) } });
    } else {
      const cur = sprints.find((s) => sprintStatus(s, today) === 'current');
      const t = await createTask({ title, dueDate: forToday ? today : undefined, sprintId: forSprint ? cur?.id : undefined });
      toast({ message: forToday || forSprint ? 'המשימה נשמרה' : 'נשמר בדואר הנכנס', action: { label: 'פתח', run: () => go(`/task/${t.id}`) } });
    }
    setText('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="רישום מהיר">
      <Seg value={kind} onChange={setKind} items={[{ id: 'task', label: 'משימה' }, { id: 'note', label: 'פתק' }]} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        style={{ marginTop: 12 }}
      >
        <input className="input" autoFocus placeholder={kind === 'task' ? 'מה צריך לעשות?' : 'מה רצית לזכור?'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
        {kind === 'task' && (
          <div className="chips" style={{ marginTop: 10 }}>
            <button type="button" className={`chip ${forToday ? 'on' : 'out'}`} onClick={() => setForToday(!forToday)}>
              <Icon name="today" size="sm" /> להיום
            </button>
            <button type="button" className={`chip ${forSprint ? 'on' : 'out'}`} onClick={() => setForSprint(!forSprint)}>
              <Icon name="sprint" size="sm" /> לספרינט הנוכחי
            </button>
          </div>
        )}
        <p className="muted small" style={{ margin: '10px 2px' }}>
          {kind === 'task' ? 'בלי תאריך, פרויקט או ספרינט, המשימה נכנסת לדואר הנכנס לסידור אחר כך.' : 'הפתק נשמר ברשימת הפתקים.'}
        </p>
        <button type="submit" className="btn primary block" disabled={!text.trim()}>
          שמור
        </button>
      </form>
    </Sheet>
  );
}
