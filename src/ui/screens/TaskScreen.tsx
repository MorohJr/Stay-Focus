import { useEffect, useRef, useState } from 'react';
import { formatDMY, localDate } from '../../domain/dates';
import { describeRule } from '../../domain/recurring';
import type { Priority, Task, TaskStatus } from '../../domain/schemas';
import { sprintStatus, SPRINT_STATUS_LABEL } from '../../domain/sprints';
import { isStuck, PRIORITY_LABEL, STATUS_EMOJI, STATUS_LABEL } from '../../domain/tasks';
import { top3 as top3Of } from '../../domain/today';
import { Q } from '../../services/queries';
import { addToTop3, createTask, deleteTask, removeFromTop3, resolveStuck, restoreTasks, setSomeday, setWaiting, updateTask } from '../../services/tasks';
import { PersonPicker } from './PeopleScreens';
import { Empty, Switch, TopBar, useToast } from '../components/common';
import { DraftInput, DraftTextarea, LabelsEditor, LinksEditor, PhotosEditor } from '../components/edit';
import { Icon } from '../components/Icon';
import { ProjectPicker, SprintPicker, TaskRow } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'archived'];

/** SPEC 5.2: the task page. Every change saves immediately. */
export function TaskScreen({ id }: { id: string }) {
  const task = useLive(() => Q.task(id), [id]);
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const recurring = useLive(Q.recurring) ?? [];
  const { today } = useClock();
  const toast = useToast();
  const [pickProject, setPickProject] = useState(false);
  const [pickSprint, setPickSprint] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [pickPerson, setPickPerson] = useState(false);
  const subRef = useRef<HTMLInputElement>(null);
  const waitingFor = useLive(() => (task?.waitingPersonId ? Q.person(task.waitingPersonId) : Promise.resolve(null)), [task?.waitingPersonId]);

  if (task === undefined) return <div className="page sub" />;
  if (task === null) {
    return (
      <div className="page sub">
        <TopBar title="משימה" backTo="/tasks" />
        <Empty icon="🔍">המשימה לא נמצאה. אולי נמחקה.</Empty>
      </div>
    );
  }

  const set = (patch: Partial<Task>) => void updateTask(task.id, patch);
  const subs = tasks.filter((t) => t.parentId === task.id).sort((a, b) => a.seq - b.seq);
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined;
  const sprint = sprints.find((s) => s.id === task.sprintId);
  const rec = recurring.find((r) => r.id === task.recurringId);
  const inTop3 = task.top3Date === today;
  const topCount = top3Of(tasks, today).length;
  const taskProjects = projects.filter((p) => task.projectIds.includes(p.id));

  const remove = async () => {
    const deleted = await deleteTask(task.id);
    back('/tasks');
    toast({ message: deleted.tasks.length > 1 ? `נמחקו ${deleted.tasks.length} משימות` : 'המשימה נמחקה', action: { label: 'בטל', run: () => void restoreTasks(deleted) } });
  };

  return (
    <div className="page sub">
      <TopBar title={<span className="muted num" style={{ fontSize: 15, fontWeight: 600 }}>משימה #{task.seq}</span>} backTo="/tasks">
        <button type="button" className="iconbtn" aria-label="מחק משימה" onClick={() => void remove()}>
          <Icon name="trash" />
        </button>
      </TopBar>

      {parent && (
        <button type="button" className="linkbtn" style={{ marginBottom: 6 }} onClick={() => go(`/task/${parent.id}`)}>
          <Icon name="chevR" size="xs" /> תת-משימה של: {parent.title}
        </button>
      )}
      <DraftInput className="title-input" value={task.title} onSave={(v) => set({ title: v })} placeholder="שם המשימה" ariaLabel="שם המשימה" />

      {isStuck(task) && (
        <section className="card" style={{ background: 'var(--warn-soft)', border: 0, marginTop: 10 }}>
          <h4 style={{ color: 'var(--warn)' }}>
            <span>🐢 נדחתה {task.postponeCount} פעמים</span>
          </h4>
          <p className="small" style={{ margin: '0 0 10px' }}>משהו פה לא עובד. מה עושים איתה?</p>
          <div className="chips tight">
            <button type="button" className="chip on" onClick={() => void resolveStuck(task.id, 'today', today)}>
              לעשות היום
            </button>
            <button
              type="button"
              className="chip out"
              onClick={async () => {
                await resolveStuck(task.id, 'split', today);
                subRef.current?.focus();
              }}
            >
              לפרק לצעדים קטנים
            </button>
            <button type="button" className="chip out" onClick={() => void resolveStuck(task.id, 'someday', today)}>
              לאולי פעם
            </button>
            <button type="button" className="chip out" onClick={() => void remove()}>
              למחוק
            </button>
          </div>
        </section>
      )}
      {task.someday && (
        <div className="banner" style={{ marginTop: 10 }}>
          <Icon name="info" size="sm" />
          <span className="grow">המשימה ב"אולי פעם" ולא מופיעה ברשימות.</span>
          <button type="button" className="minibtn p" onClick={() => void setSomeday(task.id, false)}>
            להפעיל
          </button>
        </div>
      )}

      <div className="seg" style={{ margin: '12px 0' }}>
        {STATUSES.map((s) => (
          <button key={s} type="button" className={task.status === s ? 'on' : ''} onClick={() => set({ status: s })}>
            {STATUS_EMOJI[s]} {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <section className="card">
        {!task.parentId && (
          <div className="field">
            <span className="lab">
              <Icon name="star" size="sm" /> מ-3 החשובים היום
            </span>
            <Switch
              label="3 החשובים"
              on={inTop3}
              onChange={(on) => {
                if (on) {
                  if (topCount >= 3) toast({ message: 'כבר יש 3 משימות חשובות להיום. הסר אחת קודם.' });
                  else void addToTop3(task.id, today);
                } else void removeFromTop3(task.id);
              }}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="due">
            <Icon name="cal" size="sm" /> תאריך
          </label>
          <span className="val">
            <input id="due" type="date" className="mini-input" value={task.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || undefined, ...(e.target.value ? {} : { startTime: undefined }) })} />
            {task.dueDate !== today && (
              <button type="button" className="minibtn" onClick={() => set({ dueDate: today })}>
                היום
              </button>
            )}
          </span>
        </div>
        {task.dueDate && (
          <div className="field">
            <label htmlFor="time">
              <Icon name="clock" size="sm" /> שעה ומשך
            </label>
            <span className="val">
              <input id="time" type="time" className="mini-input ltr" value={task.startTime ?? ''} onChange={(e) => set({ startTime: e.target.value || undefined })} />
              {task.startTime && (
                <select className="mini-input" aria-label="משך" value={task.durationMin ?? 30} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} דק׳` : `${m / 60} ש׳`}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </div>
        )}
        <div className="field">
          <span className="lab">
            <Icon name="folder" size="sm" /> פרויקט
          </span>
          <button type="button" className="val linkbtn" onClick={() => setPickProject(true)}>
            {taskProjects.length ? taskProjects.map((p) => p.name).join(', ') : 'בחר'}
          </button>
        </div>
        <div className="field">
          <span className="lab">
            <Icon name="sprint" size="sm" /> ספרינט
          </span>
          <button type="button" className="val linkbtn" onClick={() => setPickSprint(true)}>
            {sprint ? `${sprint.name.split(' · ')[0]} (${SPRINT_STATUS_LABEL[sprintStatus(sprint, today)]})` : 'בקלוג'}
          </button>
        </div>
        <div className="field">
          <label htmlFor="prio">
            <Icon name="flag" size="sm" /> עדיפות
          </label>
          <select id="prio" className="mini-input" value={task.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as Priority | undefined })}>
            <option value="">ללא</option>
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lab">
            <Icon name="grid" size="sm" /> דחוף · חשוב
          </span>
          <span className="val">
            <button type="button" className={`chip ${task.urgent ? 'on' : 'out'}`} onClick={() => set({ urgent: !task.urgent })}>
              דחוף
            </button>
            <button type="button" className={`chip ${task.important ? 'on' : 'out'}`} onClick={() => set({ important: !task.important })}>
              חשוב
            </button>
          </span>
        </div>
        <div className="field">
          <span className="lab">
            <Icon name="hourglass" size="sm" /> ממתין ל...
          </span>
          <button type="button" className="val linkbtn" onClick={() => setPickPerson(true)}>
            {waitingFor ? `${waitingFor.emoji} ${waitingFor.name}` : 'אף אחד'}
          </button>
        </div>
        {!task.parentId && (
          <div className="field">
            <span className="lab">
              <Icon name="sparkle" size="sm" /> אולי פעם
            </span>
            <Switch label="אולי פעם" on={task.someday} onChange={(on) => void setSomeday(task.id, on)} />
          </div>
        )}
        {rec && (
          <div className="field">
            <span className="lab">
              <Icon name="repeat" size="sm" /> חוזרת
            </span>
            <button type="button" className="val linkbtn" onClick={() => go(`/recurring/${rec.id}`)}>
              {describeRule(rec.rule)}
            </button>
          </div>
        )}
      </section>

      <div className="section-title">תגיות</div>
      <section className="card">
        <LabelsEditor labels={task.labels} onChange={(labels) => set({ labels })} />
      </section>

      {!task.parentId || subs.length > 0 ? (
        <>
          <div className="section-title">
            <span>תת-משימות</span>
            <span className="num">{subs.length ? `${subs.filter((s) => s.status === 'done').length}/${subs.length}` : ''}</span>
          </div>
          <section className="card">
            {subs.map((s) => (
              <TaskRow key={s.id} task={s} />
            ))}
            <form
              className="addrow"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!subTitle.trim()) return;
                await createTask({ title: subTitle, parentId: task.id, dueDate: task.dueDate });
                setSubTitle('');
              }}
            >
              <input ref={subRef} className="input" placeholder="+ תת-משימה" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
            </form>
          </section>
        </>
      ) : null}

      <div className="section-title">הערות</div>
      <DraftTextarea value={task.body} onSave={(v) => set({ body: v })} placeholder="פרטים, מחשבות, צעדים…" />

      <div className="section-title">קישורים</div>
      <section className="card">
        <LinksEditor links={task.links} onChange={(links) => set({ links })} />
      </section>

      <div className="section-title">תמונות</div>
      <PhotosEditor ownerType="task" ownerId={task.id} />

      <p className="muted small" style={{ marginTop: 18 }}>
        נוצרה {formatDMY(localDate(task.createdAt))}
        {task.completedAt ? ` · בוצעה ${formatDMY(localDate(task.completedAt))}` : ''}
      </p>

      <PersonPicker open={pickPerson} onClose={() => setPickPerson(false)} value={task.waitingPersonId} onChange={(id) => void setWaiting(task.id, id)} />
      <ProjectPicker open={pickProject} onClose={() => setPickProject(false)} selected={task.projectIds} onChange={(projectIds) => set({ projectIds })} />
      <SprintPicker open={pickSprint} onClose={() => setPickSprint(false)} value={task.sprintId} onChange={(sprintId) => set({ sprintId })} />
    </div>
  );
}

/** /new-task/:preset — "today", "project:<id>", "sprint:<id>". Creates on save, then opens the task. */
export function NewTaskScreen({ preset }: { preset?: string }) {
  const { today } = useClock();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const [kind, val] = (preset ?? '').split(':');
  const label = kind === 'today' ? 'להיום' : kind === 'project' ? 'לפרויקט' : kind === 'sprint' ? 'לספרינט' : 'לדואר הנכנס';
  const save = async (open: boolean) => {
    if (!title.trim()) return;
    const t = await createTask({
      title,
      dueDate: kind === 'today' ? today : undefined,
      projectIds: kind === 'project' && val ? [val] : [],
      sprintId: kind === 'sprint' ? val : undefined,
    });
    if (open) replace(`/task/${t.id}`);
    else {
      setTitle('');
      input.current?.focus();
    }
  };
  return (
    <div className="page sub">
      <TopBar title={`משימה חדשה ${label}`} backTo="/" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <input ref={input} className="title-input" placeholder="מה צריך לעשות?" value={title} onChange={(e) => setTitle(e.target.value)} enterKeyHint="next" />
        <p className="muted small">Enter שומר ומאפשר להוסיף עוד אחת.</p>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary grow" disabled={!title.trim()}>
            שמור והוסף עוד
          </button>
          <button type="button" className="btn grow" disabled={!title.trim()} onClick={() => void save(true)}>
            שמור ופתח
          </button>
        </div>
      </form>
    </div>
  );
}

