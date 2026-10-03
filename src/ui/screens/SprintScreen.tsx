import { useState } from 'react';
import type { Sprint, Task, TaskStatus } from '../../domain/schemas';
import { sprintNeedingReview, sprintStatus, SPRINT_STATUS_LABEL } from '../../domain/sprints';
import { compareForDay, completion, isActiveOpen, isOpen, isStuck, STATUS_EMOJI, STATUS_LABEL } from '../../domain/tasks';
import { isMilestoneLate, stuckForReview } from '../../domain/review';
import { addDays, formatDMY, formatRelative } from '../../domain/dates';
import { setWeeklyGoals } from '../../services/people';
import { InboxTab } from './TasksScreen';
import { reviewSprint, type ReviewMove } from '../../services/planning';
import { Q } from '../../services/queries';
import { addToSprint, createTask, deleteTask, resolveStuck, restoreTasks, setSomeday, setStatus, updateTask } from '../../services/tasks';
import { Bar, Empty, Tabs, TopBar, useToast } from '../components/common';
import { Icon } from '../components/Icon';
import { projectName, TaskRow } from '../components/tasks';
import { ProjectIcon } from '../components/ProjectIcon';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

type Tab = 'board' | 'plan' | 'all';
const NEXT: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo', archived: 'todo' };

export function SprintScreen({ tab = 'board' }: { tab?: string }) {
  const t = (['board', 'plan', 'all'].includes(tab) ? tab : 'board') as Tab;
  const { today } = useClock();
  const sprints = useLive(Q.sprints) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const cur = sprints.find((s) => sprintStatus(s, today) === 'current');
  const next = sprints.find((s) => sprintStatus(s, today) === 'next');
  const review = sprintNeedingReview(sprints, today);
  const c = completion(tasks.filter((x) => cur && x.sprintId === cur.id));
  return (
    <div className="page">
      <TopBar title="ספרינט">
        <button type="button" className="minibtn dark" onClick={() => go(review ? `/review/${review.id}` : '/review')}>
          סקירה שבועית
        </button>
      </TopBar>
      {review && (
        <button type="button" className="banner dark" style={{ width: '100%', textAlign: 'start' }} onClick={() => go(`/review/${review.id}`)}>
          <Icon name="sprint" />
          <span className="grow">הסקירה של {review.name.split(' · ')[0]} מחכה לך</span>
          <Icon name="chev" size="sm" />
        </button>
      )}
      {cur && (
        <section className="card">
          <h4>
            <span>{cur.name}</span>
            <small className="num">
              {c.done}/{c.total}
            </small>
          </h4>
          <Bar pct={c.pct} thick />
          <div className="muted small" style={{ marginTop: 6 }}>
            {c.pct}% הושלם · {formatDMY(cur.startDate)} עד {formatDMY(cur.endDate)}
          </div>
          {cur.weeklyGoals.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="muted small" style={{ fontWeight: 700, marginBottom: 4 }}>יעדי השבוע</div>
              {cur.weeklyGoals.map((g, i) => (
                <div key={i} className="small" style={{ padding: '2px 0' }}>
                  <b className="num" style={{ color: 'var(--blue-text)' }}>{i + 1}.</b> {g}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <Tabs
        value={t}
        onChange={(v) => replace(`/sprint/${v}`)}
        items={[
          { id: 'board', label: 'לוח' },
          { id: 'plan', label: 'תכנון' },
          { id: 'all', label: 'כל הספרינטים' },
        ]}
      />
      {t === 'board' && cur && <Board tasks={tasks.filter((x) => x.sprintId === cur.id && !x.parentId)} sprintId={cur.id} />}
      {t === 'plan' && <Planning tasks={tasks} cur={cur} next={next} />}
      {t === 'all' && <AllSprints sprints={sprints} tasks={tasks} />}
    </div>
  );
}

function Board({ tasks, sprintId }: { tasks: Task[]; sprintId: string }) {
  const projects = useLive(Q.projects) ?? [];
  const cols: TaskStatus[] = ['todo', 'doing', 'done'];
  if (!tasks.length) {
    return (
      <Empty icon="🏃">
        הספרינט של השבוע ריק.
        <br />
        <button type="button" className="linkbtn" onClick={() => replace('/sprint/plan')}>
          לתכנון השבוע
        </button>
      </Empty>
    );
  }
  return (
    <>
      <div className="kanban">
        {cols.map((s) => {
          const list = tasks.filter((t) => t.status === s);
          return (
            <div key={s} className="col">
              <h5>
                <span>
                  {STATUS_EMOJI[s]} {STATUS_LABEL[s]}
                </span>
                <span className="muted num">{list.length}</span>
              </h5>
              {list.map((t) => (
                <div key={t.id} className="kc">
                  <button type="button" className="grow" style={{ textAlign: 'start' }} onClick={() => go(`/task/${t.id}`)}>
                    <span style={{ textDecoration: s === 'done' ? 'line-through' : undefined, opacity: s === 'done' ? 0.6 : 1 }}>{t.title}</span>
                    {projectName(t.projectIds, projects) && <span className="tag" style={{ justifySelf: 'start' }}>{projectName(t.projectIds, projects)}</span>}
                  </button>
                  <button type="button" className="mv" aria-label={`העבר ל${STATUS_LABEL[NEXT[s]]}`} onClick={() => void setStatus(t.id, NEXT[s])}>
                    <Icon name={s === 'done' ? 'repeat' : 'chev'} size="sm" />
                  </button>
                </div>
              ))}
              {s === 'todo' && (
                <button type="button" className="addline" onClick={() => go(`/new-task/sprint:${sprintId}`)}>
                  <Icon name="plus" size="sm" /> משימה
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ margin: '6px 4px' }}>
        החץ מעביר משימה לעמודה הבאה. מחליקים ימינה ושמאלה בין העמודות.
      </p>
    </>
  );
}

/** Backlog → this week / next week (SPEC 5.3). */
export function Planning({ tasks, cur, next }: { tasks: Task[]; cur?: Sprint; next?: Sprint }) {
  const projects = useLive(Q.projects) ?? [];
  const backlog = tasks.filter((t) => isActiveOpen(t) && !t.sprintId && !t.parentId);
  const inCur = tasks.filter((t) => cur && t.sprintId === cur.id && isOpen(t) && !t.parentId);
  const inNext = tasks.filter((t) => next && t.sprintId === next.id && isOpen(t) && !t.parentId);
  const groups = [
    ...projects.filter((p) => p.status === 'active' || p.status === 'planning').map((p) => ({ key: p.id, name: <span className="row" style={{ gap: 6 }}><ProjectIcon project={p} size={20} radius={6} />{p.name}</span>, list: backlog.filter((t) => t.projectIds.includes(p.id)) })),
    { key: 'none', name: 'בלי פרויקט', list: backlog.filter((t) => !t.projectIds.some((id) => projects.find((p) => p.id === id && (p.status === 'active' || p.status === 'planning')))) },
  ].filter((g) => g.list.length);
  const remove = (t: Task) => (
    <button type="button" className="minibtn" onClick={() => void addToSprint([t.id], undefined)}>
      הסר
    </button>
  );
  return (
    <>
      <div className="section-title">
        <span>השבוע ({cur?.name.split(' · ')[0]})</span>
        <span className="num">{inCur.length}</span>
      </div>
      <section className="card">
        {inCur.map((t) => (
          <TaskRow key={t.id} task={t} projects={projects} end={remove(t)} />
        ))}
        {!inCur.length && <p className="muted small" style={{ margin: 4 }}>עוד אין משימות פתוחות השבוע.</p>}
      </section>
      {next && (
        <>
          <div className="section-title">
            <span>שבוע הבא ({next.name.split(' · ')[0]})</span>
            <span className="num">{inNext.length}</span>
          </div>
          <section className="card">
            {inNext.map((t) => (
              <TaskRow key={t.id} task={t} projects={projects} end={remove(t)} />
            ))}
            {!inNext.length && <p className="muted small" style={{ margin: 4 }}>ריק.</p>}
          </section>
        </>
      )}
      <div className="section-title">
        <span>בקלוג: משימות בלי ספרינט</span>
        <span className="num">{backlog.length}</span>
      </div>
      {!groups.length && <Empty icon="🎉">הבקלוג ריק.</Empty>}
      {groups.map((g) => (
        <section key={g.key} className="card">
          <h4>
            <span>{g.name}</span>
            <small className="num">{g.list.length}</small>
          </h4>
          {g.list.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              end={
                <span className="row" style={{ gap: 4 }}>
                  {cur && (
                    <button type="button" className="minibtn p" onClick={() => void addToSprint([t.id], cur.id)}>
                      השבוע
                    </button>
                  )}
                  {next && (
                    <button type="button" className="minibtn" onClick={() => void addToSprint([t.id], next.id)}>
                      הבא
                    </button>
                  )}
                </span>
              }
            />
          ))}
        </section>
      ))}
    </>
  );
}

function AllSprints({ sprints, tasks }: { sprints: Sprint[]; tasks: Task[] }) {
  const { today } = useClock();
  const list = [...sprints].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <section className="card">
      {list.map((s) => {
        const c = completion(tasks.filter((t) => t.sprintId === s.id));
        const st = sprintStatus(s, today);
        return (
          <button key={s.id} type="button" className="listrow" onClick={() => go(`/sprint-view/${s.id}`)}>
            <span className="grow">
              <b>{s.name}</b>
              <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
                {c.total} משימות · {c.pct}% הושלמו
              </span>
              <span style={{ display: 'block', marginTop: 6 }}>
                <Bar pct={c.pct} />
              </span>
            </span>
            <span className={`tag ${st === 'current' ? '' : 'g'}`}>{SPRINT_STATUS_LABEL[st]}</span>
          </button>
        );
      })}
    </section>
  );
}

/** One sprint's tasks (from "all sprints"). */
export function SprintViewScreen({ id }: { id: string }) {
  const sprints = useLive(Q.sprints) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const s = sprints.find((x) => x.id === id);
  if (!s) return <div className="page sub" />;
  const list = tasks.filter((t) => t.sprintId === id && !t.parentId);
  const c = completion(list);
  return (
    <div className="page sub">
      <TopBar title={s.name} backTo="/sprint/all" />
      <section className="card">
        <Bar pct={c.pct} thick />
        <div className="muted small" style={{ marginTop: 6 }}>
          {c.done}/{c.total} · {c.pct}% הושלם
        </div>
      </section>
      <section className="card">
        {list.map((t) => (
          <TaskRow key={t.id} task={t} projects={projects} />
        ))}
        {!list.length && <p className="muted small">אין משימות בספרינט הזה.</p>}
      </section>
    </div>
  );
}

const STEPS = ['השבוע שעבר', 'לרוקן את הדואר הנכנס', 'מה תקוע', 'פרויקטים בעבודה', 'השבוע הזה'];

/** R-REV: the guided weekly review (5 steps). Step 1 = R-SPR-4. */
export function ReviewScreen({ id }: { id?: string }) {
  const { today } = useClock();
  const sprints = useLive(Q.sprints);
  const tasks = useLive(Q.tasks);
  const [step, setStep] = useState(0);
  const [moves, setMoves] = useState<Record<string, ReviewMove>>({});
  const [goals, setGoals] = useState<string[] | null>(null);
  if (!sprints || !tasks) return <div className="page sub" />;
  const cur = sprints.find((x) => sprintStatus(x, today) === 'current');
  const next = sprints.find((x) => sprintStatus(x, today) === 'next');
  const last = (id ? sprints.find((x) => x.id === id) : undefined) ?? sprints.find((x) => sprintStatus(x, today) === 'last');
  if (!cur) return <div className="page sub" />;
  const goalsNow = goals ?? [...cur.weeklyGoals, '', '', ''].slice(0, 3);

  const leaveStep1 = async () => {
    if (last && !last.reviewedAt) {
      const left = tasks.filter((t) => t.sprintId === last.id && !t.parentId && isOpen(t));
      await reviewSprint(last.id, Object.fromEntries(left.map((t) => [t.id, moves[t.id] ?? 'current'])), cur.id);
    }
  };
  const go2 = async (n: number) => {
    if (step === 0 && n > 0) await leaveStep1();
    if (step === 4) await setWeeklyGoals(cur.id, goalsNow);
    setStep(n);
    window.scrollTo(0, 0);
  };
  const finish = async () => {
    if (step === 0) await leaveStep1();
    await setWeeklyGoals(cur.id, goalsNow);
    back('/sprint');
  };

  return (
    <div className="page sub">
      <TopBar title="סקירה שבועית" backTo="/sprint" />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <b>{STEPS[step]}</b>
        <span className="muted small">
          צעד <span className="num">{step + 1}</span> מתוך <span className="num">5</span>
        </span>
      </div>
      <div className="row" style={{ gap: 4, marginBottom: 14 }}>
        {STEPS.map((_, i) => (
          <i key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i <= step ? 'var(--blue)' : 'var(--track)' }} />
        ))}
      </div>

      {step === 0 && <ReviewLastWeek last={last} tasks={tasks} moves={moves} setMoves={setMoves} />}
      {step === 1 && (
        <>
          <p className="muted small" style={{ margin: '0 4px 10px' }}>כל פריט מקבל מקום: תאריך, פרויקט, ספרינט, אולי פעם, או מחיקה.</p>
          <InboxTab tasks={tasks} />
        </>
      )}
      {step === 2 && <ReviewStuck tasks={tasks} today={today} />}
      {step === 3 && <ReviewProjects tasks={tasks} today={today} />}
      {step === 4 && (
        <>
          <section className="card">
            <h4>3 יעדים לשבוע</h4>
            <p className="muted small" style={{ marginTop: 0 }}>מה יהפוך את השבוע הזה להצלחה? מוצג בראש מסך הספרינט.</p>
            {goalsNow.map((g, i) => (
              <div key={i} className="addrow" style={{ marginTop: i ? 6 : 0 }}>
                <b className="num" style={{ color: 'var(--blue-text)', width: 18 }}>{i + 1}.</b>
                <input
                  className="input"
                  value={g}
                  placeholder={['למשל: להעלות את האתר לאוויר', 'למשל: שני פרקים בספר', 'למשל: ארוחה עם המשפחה'][i]}
                  onChange={(e) => setGoals(goalsNow.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </section>
          <Planning tasks={tasks} cur={cur} next={next} />
        </>
      )}

      <div className="row" style={{ marginTop: 16, position: 'sticky', bottom: 0, background: '#fff', padding: '10px 0 calc(var(--safe-b) + 10px)', borderTop: '1px solid var(--line)' }}>
        {step > 0 && (
          <button type="button" className="btn grow" onClick={() => void go2(step - 1)}>
            חזרה
          </button>
        )}
        {step < 4 ? (
          <button type="button" className="btn primary grow" onClick={() => void go2(step + 1)}>
            הבא
          </button>
        ) : (
          <button type="button" className="btn blue grow" onClick={() => void finish()}>
            סיים את הסקירה ✓
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewLastWeek({ last, tasks, moves, setMoves }: { last?: Sprint; tasks: Task[]; moves: Record<string, ReviewMove>; setMoves: (m: Record<string, ReviewMove>) => void }) {
  if (!last) return <Empty icon="🗓️">אין ספרינט מהשבוע שעבר. אפשר להמשיך לצעד הבא.</Empty>;
  const list = tasks.filter((t) => t.sprintId === last.id && !t.parentId);
  const done = list.filter((t) => t.status === 'done');
  const left = list.filter(isOpen);
  const c = completion(list);
  const moveOf = (t: Task) => moves[t.id] ?? 'current';
  return (
    <>
      <section className="card" style={{ background: '#111', color: '#fff', border: 0 }}>
        <div className="muted small">{last.name}</div>
        <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0' }} className="num">
          {c.pct}%
        </div>
        <div style={{ fontSize: 14 }}>
          סיימת {done.length} מתוך {c.total} משימות {c.pct >= 70 ? '💪' : c.pct >= 40 ? '👍' : ''}
        </div>
        {last.weeklyGoals.length > 0 && (
          <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
            היעדים היו: {last.weeklyGoals.join(' · ')}
          </div>
        )}
      </section>
      {done.length > 0 && (
        <>
          <div className="section-title">מה הושלם</div>
          <section className="card">
            {done.map((t) => (
              <div key={t.id} className="todo done">
                <span className="box checked">
                  <Icon name="check" />
                </span>
                <span className="txt">{t.title}</span>
              </div>
            ))}
          </section>
        </>
      )}
      {left.length > 0 && !last.reviewedAt && (
        <>
          <div className="section-title">
            <span>מה נשאר ({left.length})</span>
            <button type="button" className="linkbtn" onClick={() => setMoves(Object.fromEntries(left.map((t) => [t.id, 'current'])))}>
              הכול לשבוע הזה
            </button>
          </div>
          <section className="card">
            {left.map((t) => (
              <div key={t.id} className="todo">
                <span className="txt">{t.title}</span>
                <span className="seg" style={{ flex: 'none' }}>
                  <button type="button" className={moveOf(t) === 'current' ? 'on' : ''} onClick={() => setMoves({ ...moves, [t.id]: 'current' })}>
                    לשבוע הזה
                  </button>
                  <button type="button" className={moveOf(t) === 'backlog' ? 'on' : ''} onClick={() => setMoves({ ...moves, [t.id]: 'backlog' })}>
                    לבקלוג
                  </button>
                </span>
              </div>
            ))}
          </section>
        </>
      )}
      {last.reviewedAt && <p className="muted small">השבוע הזה כבר סוכם, ומה שנשאר כבר הועבר.</p>}
    </>
  );
}

function ReviewStuck({ tasks, today }: { tasks: Task[]; today: string }) {
  const toast = useToast();
  const list = stuckForReview(tasks, today);
  if (!list.length) return <Empty icon="🚀">שום דבר לא תקוע: אין משימות באיחור ואין משימות שנדחו שוב ושוב.</Empty>;
  return (
    <>
      <p className="muted small" style={{ margin: '0 4px 10px' }}>משימות באיחור ומשימות שנדחו 3 פעמים ומעלה (🐢). החלט על כל אחת.</p>
      <section className="card">
        {list.map((t) => (
          <div key={t.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <button type="button" style={{ display: 'block', textAlign: 'right', fontSize: 14.5, unicodeBidi: 'plaintext', width: '100%' }} onClick={() => go(`/task/${t.id}`)}>
              {t.title} {isStuck(t) && <span className="tag warn">🐢 נדחתה {t.postponeCount}</span>}
              {t.dueDate && t.dueDate < today && <span className="tag warn" style={{ marginInlineStart: 4 }}>{formatRelative(t.dueDate, today)}</span>}
            </button>
            <div className="chips tight" style={{ marginTop: 6 }}>
              <button type="button" className="chip out" onClick={() => void resolveStuck(t.id, 'today', today)}>
                להיום
              </button>
              <button type="button" className="chip out" onClick={() => void updateTask(t.id, { dueDate: addDays(today, 1) })}>
                למחר
              </button>
              <button type="button" className="chip out" onClick={() => void setSomeday(t.id, true)}>
                אולי פעם
              </button>
              <button
                type="button"
                className="chip out"
                aria-label="מחק"
                onClick={async () => {
                  const d = await deleteTask(t.id);
                  toast({ message: 'נמחקה', action: { label: 'בטל', run: () => void restoreTasks(d) } });
                }}
              >
                <Icon name="trash" size="xs" />
              </button>
            </div>
          </div>
        ))}
      </section>
      <button type="button" className="linkbtn" onClick={() => go('/cleanup')}>
        לניקוי משימות ישנות (60+ יום)
      </button>
    </>
  );
}

function ReviewProjects({ tasks, today }: { tasks: Task[]; today: string }) {
  const projects = useLive(Q.projects) ?? [];
  const milestones = useLive(Q.milestones) ?? [];
  const [adding, setAdding] = useState<Record<string, string>>({});
  const active = projects.filter((p) => p.status === 'active');
  if (!active.length) return <Empty icon="🎯">אין פרויקטים בעבודה.</Empty>;
  return (
    <>
      <p className="muted small" style={{ margin: '0 4px 10px' }}>לכל פרויקט פעיל צריך צעד הבא ברור. פרויקט בלי משימה פתוחה תקוע.</p>
      {active.map((p) => {
        const open = tasks.filter((t) => t.projectIds.includes(p.id) && isActiveOpen(t) && !t.parentId).sort(compareForDay);
        const lateMs = milestones.filter((m) => m.projectId === p.id && isMilestoneLate(m, today));
        return (
          <section key={p.id} className="card">
            <h4>
              <button type="button" className="t" onClick={() => go(`/project/${p.id}`)}>
                <ProjectIcon project={p} size={24} radius={7} /> {p.name}
              </button>
              <small className="num">{open.length} פתוחות</small>
            </h4>
            {lateMs.length > 0 && <div className="tag warn" style={{ display: 'inline-block', marginBottom: 6 }}>אבן דרך באיחור: {lateMs[0]!.title}</div>}
            {open[0] ? (
              <div className="small">
                <span className="muted">הצעד הבא: </span>
                {open[0].title}
              </div>
            ) : (
              <form
                className="addrow"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const title = adding[p.id]?.trim();
                  if (!title) return;
                  await createTask({ title, projectIds: [p.id] });
                  setAdding({ ...adding, [p.id]: '' });
                }}
              >
                <input className="input" placeholder="אין צעד הבא. מה הדבר הבא לעשות?" value={adding[p.id] ?? ''} onChange={(e) => setAdding({ ...adding, [p.id]: e.target.value })} />
              </form>
            )}
          </section>
        );
      })}
    </>
  );
}
