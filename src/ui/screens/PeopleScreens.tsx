import { useState } from 'react';
import { diffDays, formatRelative, localDate } from '../../domain/dates';
import { cleanupCandidates, visibleAgenda } from '../../domain/review';
import type { Task } from '../../domain/schemas';
import { isOpen, isStuck } from '../../domain/tasks';
import { addAgenda, createPerson, deleteAgenda, deletePerson, toggleAgenda, updatePerson } from '../../services/people';
import { Q } from '../../services/queries';
import { createTask, deleteTask, keepTask, restoreTasks, setSomeday, setStatus, setWaiting } from '../../services/tasks';
import { Bar, confirmAction, Empty, Sheet, TopBar, useToast } from '../components/common';
import { DraftInput, DraftTextarea } from '../components/edit';
import { Icon } from '../components/Icon';
import { projectName, TaskRow } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { back, go } from '../router';

const EMOJIS = ['🙂', '❤️', '👩', '👨', '👵', '👴', '👧', '👦', '🧑‍💼', '🤝', '⭐', '🐶'];

// ---------------------------------------------------------------------------
// People (R-PPL)
// ---------------------------------------------------------------------------

export function PeopleScreen() {
  const people = useLive(Q.people) ?? [];
  const agenda = useLive(Q.agenda) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const [name, setName] = useState('');
  const list = [...people].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return (
    <div className="page">
      <TopBar
        title="אנשים"
        backTo="/more"
        stats={[
          { v: people.length, k: 'אנשים' },
          { v: agenda.filter((a) => !a.doneAt).length, k: 'נושאים פתוחים' },
          { v: tasks.filter((t) => t.waitingPersonId && isOpen(t)).length, k: 'ממתינות' },
        ]}
      />
      <p className="muted small" style={{ margin: '0 4px 10px' }}>
        לכל אדם: על מה לדבר איתו בפעם הבאה, ומה ממתין לו.
      </p>
      <form
        className="addrow"
        style={{ marginTop: 0, marginBottom: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const p = await createPerson(name);
          setName('');
          go(`/person/${p.id}`);
        }}
      >
        <input className="input" placeholder="+ אדם חדש, למשל אמא" value={name} onChange={(e) => setName(e.target.value)} />
      </form>
      {!list.length && <Empty icon="👥">עוד אין אנשים ברשימה.</Empty>}
      {list.length > 0 && (
        <section className="card">
          {list.map((p) => {
            const open = agenda.filter((a) => a.personId === p.id && !a.doneAt).length;
            const waiting = tasks.filter((t) => t.waitingPersonId === p.id && isOpen(t)).length;
            return (
              <button key={p.id} type="button" className="listrow" onClick={() => go(`/person/${p.id}`)}>
                <span className="ic">{p.emoji}</span>
                <span className="grow">
                  {p.name}
                  <span className="muted small" style={{ display: 'block' }}>
                    {[open ? `${open} נושאים לדבר` : '', waiting ? `${waiting} ממתינות` : ''].filter(Boolean).join(' · ') || 'אין נושאים פתוחים'}
                  </span>
                </span>
                <span className="end">
                  <Icon name="chev" size="xs" />
                </span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}

export function PersonScreen({ id }: { id: string }) {
  const p = useLive(() => Q.person(id), [id]);
  const agenda = useLive(() => Q.agendaOf(id), [id]) ?? [];
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const { today } = useClock();
  const [text, setText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  if (p === undefined) return <div className="page sub" />;
  if (p === null) {
    return (
      <div className="page sub">
        <TopBar title="אדם" backTo="/people" />
        <Empty icon="🔍">לא נמצא.</Empty>
      </div>
    );
  }
  const waiting = tasks.filter((t) => t.waitingPersonId === p.id && isOpen(t));
  return (
    <div className="page sub">
      <TopBar
        backTo="/people"
        lead={
          <button type="button" style={{ fontSize: 26, width: 50, height: 50, borderRadius: 16, background: 'rgba(255,255,255,.12)', display: 'grid', placeItems: 'center', flex: 'none' }} onClick={() => setEmojiOpen(true)} aria-label="אימוג'י">
            {p.emoji}
          </button>
        }
        title={<DraftInput className="title-input" value={p.name} onSave={(v) => v.trim() && void updatePerson(p.id, { name: v.trim() })} ariaLabel="שם" />}
        stats={[
          { v: agenda.filter((a) => !a.doneAt).length, k: 'לדבר על' },
          { v: waiting.length, k: 'ממתין לו' },
        ]}
      >
        <button
          type="button"
          className="iconbtn"
          aria-label="מחק"
          onClick={async () => {
            if (!confirmAction(`למחוק את ${p.name}? המשימות יישארו, בלי ההמתנה.`)) return;
            await deletePerson(p.id);
            back('/people');
          }}
        >
          <Icon name="trash" />
        </button>
      </TopBar>

      <div className="section-title">
        <span>לדבר על זה בפעם הבאה</span>
        <span className="num">{agenda.filter((a) => !a.doneAt).length}</span>
      </div>
      <section className="card">
        {visibleAgenda(agenda, today).map((a) => (
          <div key={a.id} className={`todo ${a.doneAt ? 'done' : ''}`}>
            <button type="button" className={`box ${a.doneAt ? 'checked' : ''}`} aria-label="דיברנו" onClick={() => void toggleAgenda(a.id)}>
              {a.doneAt && <Icon name="check" />}
            </button>
            <span className="txt">{a.text}</span>
            <button type="button" className="muted" aria-label="מחק" onClick={() => void deleteAgenda(a.id)}>
              <Icon name="x" size="xs" />
            </button>
          </div>
        ))}
        <form
          className="addrow"
          onSubmit={(e) => {
            e.preventDefault();
            void addAgenda(p.id, text);
            setText('');
          }}
        >
          <input className="input" placeholder="+ נושא, שאלה, משהו לספר" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
        <p className="muted small" style={{ margin: '8px 2px 0' }}>מסמנים ✓ אחרי שדיברתם. נושאים שסומנו נעלמים אחרי שבוע.</p>
      </section>

      <div className="section-title">
        <span>
          <Icon name="hourglass" size="xs" /> ממתין ל{p.name}
        </span>
        <span className="num">{waiting.length}</span>
      </div>
      <section className="card">
        {waiting.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            today={today}
            meta={[t.dueDate ? `לבדוק ${formatRelative(t.dueDate, today)}` : '', projectName(t.projectIds, projects) ?? ''].filter(Boolean).join(' · ') || undefined}
            end={
              <button type="button" className="minibtn p" onClick={() => void setWaiting(t.id, undefined)}>
                התקבל
              </button>
            }
          />
        ))}
        <form
          className="addrow"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!taskText.trim()) return;
            await createTask({ title: taskText, waitingPersonId: p.id });
            setTaskText('');
          }}
        >
          <input className="input" placeholder={`+ משהו שאתה מחכה ל${p.name}`} value={taskText} onChange={(e) => setTaskText(e.target.value)} />
        </form>
      </section>

      <div className="section-title">הערות</div>
      <DraftTextarea value={p.body} onSave={(v) => void updatePerson(p.id, { body: v })} placeholder="דברים שכדאי לזכור (ימי הולדת, העדפות, מה קורה אצלו)" rows={4} />

      <Sheet open={emojiOpen} onClose={() => setEmojiOpen(false)} title="אימוג'י">
        <div className="chips">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className={`chip ${p.emoji === e ? 'on' : ''}`}
              style={{ fontSize: 22 }}
              onClick={() => {
                void updatePerson(p.id, { emoji: e });
                setEmojiOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** Choose who a task is waiting for (R-WAI), or add someone new. */
export function PersonPicker({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value?: string; onChange: (id: string | undefined) => void }) {
  const people = useLive(Q.people) ?? [];
  const [name, setName] = useState('');
  const pick = (id: string | undefined) => {
    onChange(id);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="ממתין ל...">
      <form
        className="addrow"
        style={{ marginTop: 0, marginBottom: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const p = await createPerson(name);
          setName('');
          pick(p.id);
        }}
      >
        <input className="input" placeholder="אדם חדש…" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!name.trim()}>
          הוסף
        </button>
      </form>
      {value && (
        <button type="button" className="opt" onClick={() => pick(undefined)}>
          <span className="grow">לא ממתין לאף אחד</span>
        </button>
      )}
      {[...people]
        .sort((a, b) => a.name.localeCompare(b.name, 'he'))
        .map((p) => (
          <button key={p.id} type="button" className="opt" onClick={() => pick(p.id)}>
            <span>{p.emoji}</span>
            <span className="grow">{p.name}</span>
            {value === p.id && (
              <span className="check">
                <Icon name="check" />
              </span>
            )}
          </button>
        ))}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Cleanup of old tasks (R-CLN)
// ---------------------------------------------------------------------------

export function CleanupScreen() {
  const tasks = useLive(Q.tasks);
  const sprints = useLive(Q.sprints);
  const { today } = useClock();
  if (!tasks || !sprints) return <div className="page sub" />;
  // The list is fixed when the screen opens, so handled tasks don't reshuffle it.
  return <CleanupRun ids={cleanupCandidates(tasks, sprints, today).map((t) => t.id)} tasks={tasks} today={today} />;
}

function CleanupRun({ ids: initial, tasks, today }: { ids: string[]; tasks: Task[]; today: string }) {
  const projects = useLive(Q.projects) ?? [];
  const toast = useToast();
  const [ids] = useState(initial);
  const [i, setI] = useState(0);
  const t: Task | undefined = tasks.find((x) => x.id === ids[i]);
  const next = () => setI(i + 1);
  const done = i >= ids.length;
  const age = t ? diffDays(localDate(t.keptAt ?? t.createdAt), today) : 0;
  return (
    <div className="page sub">
      <TopBar title="ניקוי משימות" sub="להשאיר, לאולי פעם, לארכיון או למחוק" backTo="/more" stats={[{ v: ids.length, k: 'לסידור' }, { v: Math.min(i, ids.length), k: 'טופלו' }]} />
      {!ids.length ? (
        <Empty icon="✨">
          אין משימות ישנות לסדר.
          <br />
          כאן מופיעות משימות שלא נגעת בהן 60 יום, ומשימות שנדחו 3 פעמים ומעלה.
        </Empty>
      ) : done ? (
        <Empty icon="🎉">
          סיימת לעבור על {ids.length} משימות.
          <br />
          <button type="button" className="linkbtn" onClick={() => back('/more')}>
            חזרה
          </button>
        </Empty>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="muted small">
              <span className="num">{i + 1}</span> מתוך <span className="num">{ids.length}</span>
            </span>
            <button type="button" className="linkbtn" onClick={next}>
              דלג
            </button>
          </div>
          <Bar pct={(i / ids.length) * 100} />
          {t ? (
            <section className="card" style={{ marginTop: 14, padding: 18 }}>
              <div className="muted small">
                {isStuck(t) ? `🐢 נדחתה ${t.postponeCount} פעמים` : `לא נגעת בה ${age} ימים`}
                {projectName(t.projectIds, projects) ? ` · ${projectName(t.projectIds, projects)}` : ''}
              </div>
              <button type="button" style={{ display: 'block', fontSize: 22, fontWeight: 800, margin: '8px 0 4px', textAlign: 'right', unicodeBidi: 'plaintext' }} onClick={() => go(`/task/${t.id}`)}>
                {t.title}
              </button>
              {t.body && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{t.body.slice(0, 200)}</p>}
              <div className="stack" style={{ marginTop: 14 }}>
                <button type="button" className="btn primary" onClick={() => void keepTask(t.id).then(next)}>
                  להשאיר, זה עוד רלוונטי
                </button>
                <div className="row">
                  <button type="button" className="btn grow" onClick={() => void setSomeday(t.id, true).then(next)}>
                    לאולי פעם
                  </button>
                  <button type="button" className="btn grow" onClick={() => void setStatus(t.id, 'archived').then(next)}>
                    לארכיון
                  </button>
                </div>
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    const d = await deleteTask(t.id);
                    toast({ message: 'נמחקה', action: { label: 'בטל', run: () => void restoreTasks(d) } });
                    next();
                  }}
                >
                  למחוק
                </button>
              </div>
            </section>
          ) : (
            <button type="button" className="btn block" style={{ marginTop: 14 }} onClick={next}>
              הבאה
            </button>
          )}
        </>
      )}
    </div>
  );
}
