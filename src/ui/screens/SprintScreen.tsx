import { useState } from 'react';
import { formatDMY } from '../../domain/dates';
import type { Sprint, Task, TaskStatus } from '../../domain/schemas';
import { sprintNeedingReview, sprintStatus, SPRINT_STATUS_LABEL } from '../../domain/sprints';
import { completion, isOpen, STATUS_EMOJI, STATUS_LABEL } from '../../domain/tasks';
import { reviewSprint, type ReviewMove } from '../../services/planning';
import { Q } from '../../services/queries';
import { addToSprint, setStatus } from '../../services/tasks';
import { Bar, Empty, Tabs, TopBar } from '../components/common';
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
      <TopBar title="ספרינט" />
      {review && (
        <button type="button" className="banner dark" style={{ width: '100%', textAlign: 'start' }} onClick={() => go(`/review/${review.id}`)}>
          <Icon name="sprint" />
          <span className="grow">סיכום {review.name.split(' · ')[0]} מחכה לך</span>
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
function Planning({ tasks, cur, next }: { tasks: Task[]; cur?: Sprint; next?: Sprint }) {
  const projects = useLive(Q.projects) ?? [];
  const backlog = tasks.filter((t) => isOpen(t) && !t.sprintId && !t.parentId);
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

/** R-SPR-4: weekly summary with carry-over. */
export function ReviewScreen({ id }: { id: string }) {
  const { today } = useClock();
  const sprints = useLive(Q.sprints) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const [moves, setMoves] = useState<Record<string, ReviewMove>>({});
  const s = sprints.find((x) => x.id === id);
  const cur = sprints.find((x) => sprintStatus(x, today) === 'current');
  if (!s || !cur) return <div className="page sub" />;
  const list = tasks.filter((t) => t.sprintId === s.id && !t.parentId);
  const done = list.filter((t) => t.status === 'done');
  const left = list.filter(isOpen);
  const c = completion(list);
  const moveOf = (t: Task) => moves[t.id] ?? 'current';
  return (
    <div className="page sub">
      <TopBar title="סיכום שבוע" backTo="/" />
      <section className="card" style={{ background: '#111', color: '#fff', border: 0 }}>
        <div className="muted small">{s.name}</div>
        <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0' }} className="num">
          {c.pct}%
        </div>
        <div style={{ fontSize: 14 }}>
          סיימת {done.length} מתוך {c.total} משימות {c.pct >= 70 ? '💪' : c.pct >= 40 ? '👍' : ''}
        </div>
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
      {left.length > 0 && (
        <>
          <div className="section-title">
            <span>מה נשאר ({left.length})</span>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="linkbtn" onClick={() => setMoves(Object.fromEntries(left.map((t) => [t.id, 'current'])))}>
                הכול לשבוע הזה
              </button>
            </span>
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
      <button
        type="button"
        className="btn primary block"
        style={{ marginTop: 10 }}
        onClick={async () => {
          await reviewSprint(s.id, Object.fromEntries(left.map((t) => [t.id, moveOf(t)])), cur.id);
          back('/sprint');
        }}
      >
        סיים את הסיכום
      </button>
    </div>
  );
}
