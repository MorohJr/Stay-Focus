import { useEffect, useRef, useState } from 'react';
import { formatDMY, formatShort, localDate } from '../../domain/dates';
import { focusGoal, goalProgress, projectCompletion } from '../../domain/goals';
import type { Area, Goal, Priority, Project, ProjectStatus, Task } from '../../domain/schemas';
import { activeBlockers, compareForDay, isOpen, PRIORITY_LABEL } from '../../domain/tasks';
import { createGoal, createProject, deleteGoal, deleteProject, noteTitle, setFocusGoal, updateGoal, updateProject } from '../../services/planning';
import { Q } from '../../services/queries';
import { createTask } from '../../services/tasks';
import { addMilestone, deleteMilestone, moveMilestone, toggleMilestone, updateMilestone } from '../../services/people';
import { isMilestoneLate, milestoneStats, nextMilestone } from '../../domain/review';
import { removeProjectImage, setProjectImage } from '../../services/misc';
import { shrinkImage } from '../../services/platform';
import { ProjectCover, ProjectIcon, useBlobUrl } from '../components/ProjectIcon';
import { Bar, confirmAction, Empty, Seg, Sheet, Tabs, TopBar } from '../components/common';
import { DraftInput, DraftTextarea } from '../components/edit';
import { Icon } from '../components/Icon';
import { TaskRow } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

type Tab = 'active' | 'planning' | 'goals' | 'archive';
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { planning: 'תכנון', active: 'בעבודה', done: 'הושלם', archived: 'בארכיון' };
const ICONS = ['🎯', '🌐', '💪', '🏠', '❤️', '🎓', '💻', '💰', '🧩', '🎬', '📚', '✈️', '🐶', '🚗', '🕍', '🦷', '🧠', '📈'];

export function ProjectsScreen({ tab = 'active' }: { tab?: string }) {
  const t = (['active', 'planning', 'goals', 'archive'].includes(tab) ? tab : 'active') as Tab;
  const projects = useLive(Q.projects) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const areas = useLive(Q.areas) ?? [];
  const goals = useLive(Q.goals) ?? [];
  const count = (s: ProjectStatus[]) => projects.filter((p) => s.includes(p.status)).length;
  return (
    <div className="page">
      <TopBar
        title="פרויקטים"
        stats={[
          { v: count(['active']), k: 'בעבודה' },
          { v: count(['planning']), k: 'בתכנון' },
          { v: goals.filter((g) => g.status === 'active').length, k: 'מטרות' },
          { v: count(['done']), k: 'הושלמו' },
        ]}
      >
        <button type="button" className="iconbtn" aria-label="חדש" onClick={() => go(t === 'goals' ? '/goal/new' : '/project/new')}>
          <Icon name="plus" />
        </button>
      </TopBar>
      <Tabs
        value={t}
        onChange={(v) => replace(`/projects/${v}`)}
        items={[
          { id: 'active', label: 'בעבודה', count: count(['active']) },
          { id: 'planning', label: 'תכנון', count: count(['planning']) },
          { id: 'goals', label: 'מטרות', count: goals.filter((g) => g.status === 'active').length },
          { id: 'archive', label: 'ארכיון' },
        ]}
      />
      {t === 'goals' ? (
        <GoalsList goals={goals} projects={projects} tasks={tasks} />
      ) : (
        <ProjectGroups projects={projects.filter((p) => (t === 'archive' ? p.status === 'done' || p.status === 'archived' : p.status === t))} all={projects} tasks={tasks} areas={areas} empty={t} />
      )}
    </div>
  );
}

function ProjectGroups({ projects, all, tasks, areas, empty }: { projects: Project[]; all: Project[]; tasks: Task[]; areas: Area[]; empty: Tab }) {
  if (!projects.length) {
    return (
      <Empty icon={empty === 'archive' ? '🗄️' : '🎯'}>
        {empty === 'active' ? 'אין פרויקטים בעבודה. העבר פרויקט מ"תכנון" או צור חדש.' : empty === 'planning' ? 'אין פרויקטים בתכנון.' : 'הארכיון ריק.'}
        <br />
        {empty !== 'archive' && (
          <button type="button" className="linkbtn" onClick={() => go('/project/new')}>
            <Icon name="plus" size="xs" /> פרויקט חדש
          </button>
        )}
      </Empty>
    );
  }
  const groups = [...areas.map((a) => ({ key: a.id, name: a.name, color: a.color, list: projects.filter((p) => p.areaId === a.id) })), { key: 'none', name: 'בלי תחום', color: '#999', list: projects.filter((p) => !p.areaId || !areas.some((a) => a.id === p.areaId)) }].filter((g) => g.list.length);
  const rank = (p: Project) => (p.priority === 'high' ? 0 : p.priority === 'medium' ? 1 : p.priority === 'low' ? 2 : 3);
  return (
    <>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="section-title">
            <span className="row" style={{ gap: 6 }}>
              <i style={{ width: 8, height: 8, borderRadius: 4, background: g.color, display: 'inline-block' }} />
              {g.name}
            </span>
            <span className="num">{g.list.length}</span>
          </div>
          {g.list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'he')).map((p) => (
            <ProjectCard key={p.id} p={p} all={all} tasks={tasks} />
          ))}
        </div>
      ))}
    </>
  );
}

function ProjectCard({ p, all, tasks }: { p: Project; all: Project[]; tasks: Task[] }) {
  const ms = useLive(() => Q.milestonesOf(p.id), [p.id]) ?? [];
  const { today } = useClock();
  const nextMs = nextMilestone(ms);
  const c = projectCompletion(p, tasks);
  const blockers = activeBlockers(p, all);
  // SPEC 5.0: a dense row; the cover (R-PRJ-3) is a thin strip above it.
  return (
    <button type="button" style={{ display: 'block', width: '100%', textAlign: 'start' }} onClick={() => go(`/project/${p.id}`)}>
      {p.coverId && (
        <div style={{ borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
          <ProjectCover project={p} height={44} />
        </div>
      )}
      <div className="prow">
        <ProjectIcon project={p} size={32} radius={9} />
        <span className="grow">
          <span className="name">{p.name}</span>
          <span className="m">
            <span className="ltr">{c.total ? `${c.done}/${c.total}` : '0'}</span> משימות
            {p.endDate && <span>· עד {formatDMY(p.endDate)}</span>}
            {p.priority === 'high' && <span className="tag red">גבוהה</span>}
            {blockers.length > 0 && <span className="tag g">🔒 {blockers[0]!.name}</span>}
            {nextMs && (
              <span>
                · <Icon name="milestone" size="xs" /> {nextMs.title}
                {isMilestoneLate(nextMs, today) && <span className="tag warn" style={{ marginInlineStart: 4 }}>באיחור</span>}
              </span>
            )}
          </span>
        </span>
        <span className="minibar">
          <i style={{ width: `${c.pct}%` }} />
        </span>
        <span className="pct">{c.pct}%</span>
      </div>
    </button>
  );
}

function GoalsList({ goals, projects, tasks }: { goals: Goal[]; projects: Project[]; tasks: Task[] }) {
  const focus = focusGoal(goals);
  const list = [...goals].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.targetDate ?? '9').localeCompare(b.targetDate ?? '9'));
  if (!list.length) {
    return (
      <Empty icon="🏔️">
        מטרות הן הדברים הגדולים (למשל "500K₪ עד גיל 35"). מחברים אליהן פרויקטים, ורואים כמה התקדמת.
        <br />
        <button type="button" className="linkbtn" onClick={() => go('/goal/new')}>
          <Icon name="plus" size="xs" /> מטרה חדשה
        </button>
      </Empty>
    );
  }
  return (
    <>
      {list.map((g) => {
        const pct = goalProgress(g, projects, tasks);
        return (
          <button key={g.id} type="button" className="prow" onClick={() => go(`/goal/${g.id}`)} style={{ opacity: g.status === 'active' ? 1 : 0.6 }}>
            <span className="ic" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface2)', display: 'grid', placeItems: 'center', flex: 'none' }}>{g.status === 'achieved' ? '🏆' : '🏔️'}</span>
            <span className="grow">
              <span className="name">{g.title}</span>
              <span className="m">
                {projects.filter((p) => p.goalId === g.id).length} פרויקטים{g.targetDate ? ` · עד ${formatDMY(g.targetDate)}` : ''}
                {focus?.id === g.id && <span className="tag">בפוקוס</span>}
              </span>
            </span>
            <span className="minibar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="pct">{pct}%</span>
          </button>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Project page
// ---------------------------------------------------------------------------

export function ProjectScreen({ id }: { id: string }) {
  const p = useLive(() => Q.project(id), [id]);
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const areas = useLive(Q.areas) ?? [];
  const goals = useLive(Q.goals) ?? [];
  const notes = useLive(Q.notes) ?? [];
  const { today } = useClock();
  const [newTask, setNewTask] = useState('');
  const [iconOpen, setIconOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const coverUrl = useBlobUrl(p?.coverId);
  const msList = useLive(() => Q.milestonesOf(id), [id]) ?? [];
  const msStats = milestoneStats(msList, today);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [showDone, setShowDone] = useState(false);
  if (p === undefined) return <div className="page sub" />;
  if (p === null) {
    return (
      <div className="page sub">
        <TopBar title="פרויקט" backTo="/projects" />
        <Empty icon="🔍">הפרויקט לא נמצא.</Empty>
      </div>
    );
  }
  const set = (patch: Partial<Project>) => void updateProject(p.id, patch);
  const mine = tasks.filter((t) => t.projectIds.includes(p.id) && !t.parentId);
  const open = mine.filter(isOpen).sort(compareForDay);
  const done = mine.filter((t) => t.status === 'done');
  const c = projectCompletion(p, tasks);
  const linkedNotes = notes.filter((n) => n.projectIds.includes(p.id));
  const blockers = activeBlockers(p, projects);
  return (
    <div className="page sub">
      <TopBar
        backTo="/projects"
        cover={coverUrl}
        lead={
          <button type="button" style={{ borderRadius: 16, border: '2px solid rgba(255,255,255,.85)', flex: 'none' }} onClick={() => setIconOpen(true)} aria-label="לוגו או אייקון">
            <ProjectIcon project={p} size={50} radius={14} />
          </button>
        }
        title={<DraftInput className="title-input" value={p.name} onSave={(v) => set({ name: v })} placeholder="שם הפרויקט" ariaLabel="שם הפרויקט" />}
        sub={[PROJECT_STATUS_LABEL[p.status], areas.find((a) => a.id === p.areaId)?.name, blockers.length ? `🔒 חסום ע"י ${blockers.map((b) => b.name).join(', ')}` : ''].filter(Boolean).join(' · ')}
        stats={[
          { v: `${c.pct}%`, k: 'הושלם' },
          { v: <span className="ltr">{c.done}/{c.total}</span>, k: 'משימות' },
          { v: <span className="ltr">{msStats.done}/{msStats.total}</span>, k: 'אבני דרך' },
          ...(p.endDate ? [{ v: <span className="ltr">{formatShort(p.endDate)}</span>, k: 'סיום' }] : []),
        ]}
      >
        <button type="button" className="iconbtn" aria-label={p.coverId ? 'החלף תמונת רקע' : 'הוסף תמונת רקע'} onClick={() => setImgOpen(true)}>
          <Icon name="image" />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="מחק פרויקט"
          onClick={async () => {
            if (!confirmAction(`למחוק את "${p.name}"? המשימות והפתקים יישארו, בלי הפרויקט.`)) return;
            await deleteProject(p.id);
            back('/projects');
          }}
        >
          <Icon name="trash" />
        </button>
      </TopBar>
      <div style={{ margin: '0 2px 12px' }}>
        <Bar pct={c.pct} />
      </div>
      <Seg value={p.status} onChange={(status) => set({ status })} items={(['planning', 'active', 'done', 'archived'] as ProjectStatus[]).map((s) => ({ id: s, label: PROJECT_STATUS_LABEL[s] }))} />
      <section className="card" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="area">תחום</label>
          <select id="area" className="mini-input" value={p.areaId ?? ''} onChange={(e) => set({ areaId: e.target.value || undefined })}>
            <option value="">ללא</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="prio">עדיפות</label>
          <select id="prio" className="mini-input" value={p.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as Priority | undefined })}>
            <option value="">ללא</option>
            {(['high', 'medium', 'low'] as Priority[]).map((x) => (
              <option key={x} value={x}>
                {PRIORITY_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lab">תאריכים</span>
          <span className="val">
            <input type="date" className="mini-input" aria-label="התחלה" value={p.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || undefined })} />
            <span className="muted">עד</span>
            <input type="date" className="mini-input" aria-label="סיום" value={p.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} />
          </span>
        </div>
        <div className="field">
          <label htmlFor="goal">מטרה</label>
          <select id="goal" className="mini-input" value={p.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || undefined })}>
            <option value="">ללא</option>
            {goals.filter((g) => g.status !== 'archived' || g.id === p.goalId).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lab">חסום ע"י</span>
          <button type="button" className="val linkbtn" onClick={() => setBlockOpen(true)}>
            {p.blockedByIds.length ? projects.filter((x) => p.blockedByIds.includes(x.id)).map((x) => x.name).join(', ') : 'אף פרויקט'}
          </button>
        </div>
      </section>

      <Milestones projectId={p.id} />

      <div className="section-title">תיאור</div>
      <DraftTextarea value={p.body} onSave={(v) => set({ body: v })} placeholder="מה המטרה של הפרויקט? איך ייראה 'הושלם'?" rows={4} />

      <div className="section-title">
        <span>משימות</span>
        <span className="num">{open.length} פתוחות</span>
      </div>
      <section className="card">
        {open.map((t) => (
          <TaskRow key={t.id} task={t} today={today} />
        ))}
        <form
          className="addrow"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newTask.trim()) return;
            await createTask({ title: newTask, projectIds: [p.id] });
            setNewTask('');
          }}
        >
          <input className="input" placeholder="+ משימה לפרויקט" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
        </form>
        {done.length > 0 && (
          <button type="button" className="linkbtn" style={{ marginTop: 10 }} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'הסתר' : 'הצג'} {done.length} שבוצעו
          </button>
        )}
        {showDone && done.map((t) => <TaskRow key={t.id} task={t} />)}
      </section>

      <div className="section-title">
        <span>פתקים</span>
        <button type="button" className="linkbtn" onClick={() => go(`/note/new/project:${p.id}`)}>
          <Icon name="plus" size="xs" /> פתק
        </button>
      </div>
      <section className="card">
        {linkedNotes.map((n) => (
          <button key={n.id} type="button" className="listrow" onClick={() => go(`/note/${n.id}`)}>
            <span className="ic">
              <Icon name="note" size="sm" />
            </span>
            <span className="grow ellipsis">{noteTitle(n)}</span>
          </button>
        ))}
        {!linkedNotes.length && <p className="muted small" style={{ margin: 4 }}>אין פתקים מקושרים.</p>}
      </section>

      <Sheet open={iconOpen} onClose={() => setIconOpen(false)} title="לוגו או אייקון">
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn grow" onClick={() => logoRef.current?.click()}>
            <Icon name="upload" size="sm" /> {p.logoId ? 'החלף לוגו' : 'העלה לוגו'}
          </button>
          {p.logoId && (
            <button type="button" className="btn danger" onClick={() => void removeProjectImage(p.id, 'logo')}>
              הסר לוגו
            </button>
          )}
        </div>
        <p className="muted small" style={{ margin: '0 2px 8px' }}>{p.logoId ? 'כשיש לוגו הוא מוצג במקום האייקון.' : 'או בחר אייקון:'}</p>
        <div className="chips">
          {ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              className={`chip ${p.icon === ic ? 'on' : ''}`}
              style={{ fontSize: 22 }}
              onClick={() => {
                set({ icon: ic });
                setIconOpen(false);
              }}
            >
              {ic}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={imgOpen} onClose={() => setImgOpen(false)} title="תמונת רקע">
        <button type="button" className="btn primary block" onClick={() => coverRef.current?.click()}>
          <Icon name="image" size="sm" /> {p.coverId ? 'בחר תמונה אחרת' : 'בחר תמונה'}
        </button>
        {p.coverId && (
          <button
            type="button"
            className="btn danger block"
            style={{ marginTop: 8 }}
            onClick={async () => {
              await removeProjectImage(p.id, 'cover');
              setImgOpen(false);
            }}
          >
            הסר תמונת רקע
          </button>
        )}
      </Sheet>
      <input
        ref={logoRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          await setProjectImage(p.id, 'logo', await shrinkImage(f, 512, 'image/png'), f.name);
          setIconOpen(false);
        }}
      />
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          await setProjectImage(p.id, 'cover', await shrinkImage(f, 1600), f.name);
          setImgOpen(false);
        }}
      />
      <Sheet open={blockOpen} onClose={() => setBlockOpen(false)} title="חסום ע״י">
        {projects
          .filter((x) => x.id !== p.id && x.status !== 'archived')
          .map((x) => {
            const on = p.blockedByIds.includes(x.id);
            return (
              <button key={x.id} type="button" className="opt" onClick={() => set({ blockedByIds: on ? p.blockedByIds.filter((y) => y !== x.id) : [...p.blockedByIds, x.id] })}>
                <ProjectIcon project={x} size={28} radius={8} />
                <span className="grow">{x.name}</span>
                {on && (
                  <span className="check">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            );
          })}
      </Sheet>
    </div>
  );
}

/** /project/new (SPEC 5.4). */
export function NewProjectScreen() {
  const areas = useLive(Q.areas) ?? [];
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planning');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="page sub">
      <TopBar title="פרויקט חדש" backTo="/projects" />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const p = await createProject({ name: name.trim(), areaId: areaId || undefined, status });
          replace(`/project/${p.id}`);
        }}
      >
        <input ref={ref} className="title-input" placeholder="שם הפרויקט" value={name} onChange={(e) => setName(e.target.value)} />
        <section className="card" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="na">תחום</label>
            <select id="na" className="mini-input" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">ללא</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ns">סטטוס</label>
            <select id="ns" className="mini-input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              <option value="planning">תכנון</option>
              <option value="active">בעבודה</option>
            </select>
          </div>
        </section>
        <button type="submit" className="btn primary block" disabled={!name.trim()}>
          צור פרויקט
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goal page
// ---------------------------------------------------------------------------

export function GoalScreen({ id }: { id: string }) {
  const isNew = id === 'new';
  const g = useLive(() => (isNew ? Promise.resolve(null) : Q.goal(id)), [id]);
  const projects = useLive(Q.projects) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const areas = useLive(Q.areas) ?? [];
  const goals = useLive(Q.goals) ?? [];
  const [title, setTitle] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  if (isNew) {
    return (
      <div className="page sub">
        <TopBar title="מטרה חדשה" backTo="/projects/goals" />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const created = await createGoal({ title: title.trim(), inFocus: goals.filter((x) => x.status === 'active').length === 0 });
            replace(`/goal/${created.id}`);
          }}
        >
          <input className="title-input" autoFocus placeholder="למשל: 500K₪ עד גיל 35" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="muted small">אחרי השמירה אפשר להוסיף תאריך יעד, תיאור ולחבר פרויקטים.</p>
          <button type="submit" className="btn primary block" disabled={!title.trim()}>
            צור מטרה
          </button>
        </form>
      </div>
    );
  }
  if (g === undefined) return <div className="page sub" />;
  if (g === null) {
    return (
      <div className="page sub">
        <TopBar title="מטרה" backTo="/projects/goals" />
        <Empty icon="🔍">המטרה לא נמצאה.</Empty>
      </div>
    );
  }
  const set = (patch: Partial<Goal>) => void updateGoal(g.id, patch);
  const pct = goalProgress(g, projects, tasks);
  const linked = projects.filter((p) => p.goalId === g.id);
  const focus = focusGoal(goals);
  return (
    <div className="page sub">
      <TopBar
        backTo="/projects/goals"
        lead={<span style={{ fontSize: 30 }}>{g.status === 'achieved' ? '🏆' : '🏔️'}</span>}
        title={<DraftInput className="title-input" value={g.title} onSave={(v) => set({ title: v })} placeholder="המטרה" ariaLabel="המטרה" />}
        sub={focus?.id === g.id ? 'בפוקוס בדף הבית' : undefined}
        stats={[
          { v: `${pct}%`, k: g.progressMode === 'manual' ? 'התקדמות (ידני)' : 'התקדמות' },
          { v: linked.length, k: 'פרויקטים' },
          ...(g.targetDate ? [{ v: <span className="ltr">{formatDMY(g.targetDate)}</span>, k: 'יעד' }] : []),
        ]}
      >
        {focus?.id !== g.id && (
          <button type="button" className="minibtn p" onClick={() => void setFocusGoal(g.id)}>
            שים בפוקוס
          </button>
        )}
        <button
          type="button"
          className="iconbtn"
          aria-label="מחק מטרה"
          onClick={async () => {
            if (!confirmAction(`למחוק את המטרה "${g.title}"? הפרויקטים יישארו.`)) return;
            await deleteGoal(g.id);
            back('/projects/goals');
          }}
        >
          <Icon name="trash" />
        </button>
      </TopBar>
      <div style={{ margin: '0 2px 12px' }}>
        <Bar pct={pct} />
      </div>
      <section className="card">
        <div className="field">
          <span className="lab">סטטוס</span>
          <select className="mini-input" aria-label="סטטוס" value={g.status} onChange={(e) => set({ status: e.target.value as Goal['status'] })}>
            <option value="active">פעילה</option>
            <option value="achieved">הושגה 🏆</option>
            <option value="archived">בארכיון</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="gt">תאריך יעד</label>
          <input id="gt" type="date" className="mini-input" value={g.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label htmlFor="ga">תחום</label>
          <select id="ga" className="mini-input" value={g.areaId ?? ''} onChange={(e) => set({ areaId: e.target.value || undefined })}>
            <option value="">ללא</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lab">איך מודדים</span>
          <Seg value={g.progressMode} onChange={(progressMode) => set({ progressMode })} items={[{ id: 'projects', label: 'לפי פרויקטים' }, { id: 'manual', label: 'ידני' }]} />
        </div>
        {g.progressMode === 'manual' && (
          <div className="field">
            <label htmlFor="gm">התקדמות</label>
            <span className="val">
              <input id="gm" type="range" min={0} max={100} step={5} value={g.manualProgress} onChange={(e) => set({ manualProgress: Number(e.target.value) })} />
              <b className="num">{g.manualProgress}%</b>
            </span>
          </div>
        )}
      </section>
      <div className="section-title">
        <span>פרויקטים שמקדמים את המטרה</span>
        <button type="button" className="linkbtn" onClick={() => setLinkOpen(true)}>
          <Icon name="link" size="xs" /> חבר
        </button>
      </div>
      <section className="card">
        {linked.map((p) => (
          <button key={p.id} type="button" className="listrow" onClick={() => go(`/project/${p.id}`)}>
            <ProjectIcon project={p} size={34} radius={11} />
            <span className="grow">{p.name}</span>
            <span className="end num">{projectCompletion(p, tasks).pct}%</span>
          </button>
        ))}
        {!linked.length && <p className="muted small" style={{ margin: 4 }}>עוד לא חוברו פרויקטים.</p>}
      </section>
      <div className="section-title">תיאור</div>
      <DraftTextarea value={g.body} onSave={(v) => set({ body: v })} placeholder="למה זה חשוב לך? איך תדע שהגעת?" rows={4} />
      <Sheet open={linkOpen} onClose={() => setLinkOpen(false)} title="חבר פרויקטים">
        {projects
          .filter((p) => p.status !== 'archived')
          .map((p) => {
            const on = p.goalId === g.id;
            return (
              <button key={p.id} type="button" className="opt" onClick={() => void updateProject(p.id, { goalId: on ? undefined : g.id })}>
                <ProjectIcon project={p} size={28} radius={8} />
                <span className="grow">{p.name}</span>
                {p.goalId && !on && <span className="tag g">במטרה אחרת</span>}
                {on && (
                  <span className="check">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            );
          })}
      </Sheet>
    </div>
  );
}

/** R-MIL: milestones inside a project. */
function Milestones({ projectId }: { projectId: string }) {
  const list = (useLive(() => Q.milestonesOf(projectId), [projectId]) ?? []).sort((a, b) => a.order - b.order);
  const { today } = useClock();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const st = milestoneStats(list, today);
  return (
    <>
      <div className="section-title">
        <span>
          <Icon name="milestone" size="xs" /> אבני דרך
        </span>
        {st.total > 0 && (
          <span className="num">
            {st.done} מתוך {st.total} · {st.onTime} בזמן
          </span>
        )}
      </div>
      <section className="card">
        {st.total > 0 && (
          <div style={{ marginBottom: 6 }}>
            <Bar pct={(st.done / st.total) * 100} />
          </div>
        )}
        {list.map((m, i) => {
          const late = isMilestoneLate(m, today);
          return (
            <div key={m.id} className={`todo ${m.doneAt ? 'done' : ''}`}>
              <button type="button" className={`box ${m.doneAt ? 'checked' : ''}`} style={{ borderRadius: 7 }} aria-label={`סמן ${m.title}`} onClick={() => void toggleMilestone(m.id)}>
                {m.doneAt && <Icon name="check" />}
              </button>
              <span className="txt">
                {m.title}
                <span className="sub">
                  {m.doneAt ? `הושגה ${formatDMY(localDate(m.doneAt))}` : m.dueDate ? `יעד ${formatDMY(m.dueDate)}` : 'בלי תאריך'}
                  {late && <span className="tag warn" style={{ marginInlineStart: 6 }}>באיחור</span>}
                </span>
              </span>
              <input type="date" className="mini-input" aria-label="תאריך יעד" style={{ width: 34, padding: '6px 4px', color: 'transparent' }} value={m.dueDate ?? ''} onChange={(e) => void updateMilestone(m.id, { dueDate: e.target.value || undefined })} />
              <button type="button" className="muted" aria-label="למעלה" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => void moveMilestone(m.id, -1)}>
                <Icon name="up" size="sm" />
              </button>
              <button type="button" className="muted" aria-label="מחק" onClick={() => confirmAction(`למחוק את "${m.title}"?`) && void deleteMilestone(m.id)}>
                <Icon name="x" size="xs" />
              </button>
            </div>
          );
        })}
        <form
          className="addrow"
          onSubmit={async (e) => {
            e.preventDefault();
            await addMilestone(projectId, title, date || undefined);
            setTitle('');
            setDate('');
          }}
        >
          <input className="input" placeholder="+ אבן דרך, למשל: גרסה ראשונה באוויר" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" className="mini-input" aria-label="תאריך יעד" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 'none', width: 130 }} />
        </form>
      </section>
    </>
  );
}
