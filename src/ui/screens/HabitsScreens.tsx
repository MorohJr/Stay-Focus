import { useState } from 'react';
import { challengeDay, challengeLength, challengePhase, dayMark, dayStats, ruleValue, streak } from '../../domain/challenge';
import { addDays, formatDMY, HE_DAYS } from '../../domain/dates';
import { describeRule } from '../../domain/recurring';
import type { RecurrenceRule, Recurring, RoutineKind, RoutineSettings } from '../../domain/schemas';
import { ROUTINE_LABEL } from '../../domain/routine';
import { getSettings, updateSettings } from '../../services/entity';
import { addRoutineItem, createChallenge, cycleRule, deleteChallenge, deleteRecurring, deleteRoutineItem, moveRoutineItem, newRule, saveRecurring, updateChallenge, updateRoutineItem } from '../../services/habits';
import { Q } from '../../services/queries';
import { confirmAction, Empty, Seg, Switch, TopBar } from '../components/common';
import { DraftInput } from '../components/edit';
import { Icon } from '../components/Icon';
import { ProjectPicker } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

// ---------------------------------------------------------------------------
// Challenges (SPEC 5.7)
// ---------------------------------------------------------------------------

export function ChallengesScreen() {
  const list = useLive(Q.challenges) ?? [];
  const logs = useLive(Q.allChallengeLogs) ?? [];
  const { today } = useClock();
  const phaseLabel = { active: 'פעיל', future: 'עתידי', ended: 'הסתיים' };
  return (
    <div className="page">
      <TopBar title="אתגרים" backTo="/more">
        <button type="button" className="iconbtn" aria-label="אתגר חדש" onClick={() => go('/challenge/new')}>
          <Icon name="plus" />
        </button>
      </TopBar>
      {!list.length && (
        <Empty icon="🥇">
          אתגר = תקופה עם חוקים (למשל 90 יום: רק מים, בלי סוכר, אימון כל יום). מסמנים כל יום בדף הבית, ורואים רצף.
          <br />
          <button type="button" className="linkbtn" onClick={() => go('/challenge/new')}>
            <Icon name="plus" size="xs" /> אתגר חדש
          </button>
        </Empty>
      )}
      {[...list].reverse().map((c) => {
        const ph = challengePhase(c, today);
        return (
          <button key={c.id} type="button" className="card pcard" onClick={() => go(`/challenge/${c.id}`)}>
            <div className="top">
              <span className="ic">{ph === 'ended' ? '🏁' : '🥇'}</span>
              <span className="grow">
                <span className="name">{c.name}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  {formatDMY(c.startDate)}–{formatDMY(c.endDate)} · {c.rules.length} חוקים
                </span>
              </span>
              <span className={`tag ${ph === 'active' ? '' : 'g'}`}>{phaseLabel[ph]}</span>
            </div>
            {ph === 'active' && (
              <div className="meta">
                <span className="tag g">
                  יום {challengeDay(c, today)} מתוך {challengeLength(c)}
                </span>
                <span className="tag g">🔥 {streak(c, logs, today)} ימים ברצף</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ChallengeScreen({ id }: { id: string }) {
  const { today } = useClock();
  if (id === 'new') return <NewChallenge today={today} />;
  return <ChallengeDetail id={id} today={today} />;
}

function NewChallenge({ today }: { today: string }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(today);
  const [days, setDays] = useState(90);
  const [rules, setRules] = useState<string[]>(['']);
  return (
    <div className="page sub">
      <TopBar title="אתגר חדש" backTo="/challenges" />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const c = await createChallenge({ name: name.trim(), startDate: start, endDate: addDays(start, days - 1), rules });
          replace(`/challenge/${c.id}`);
        }}
      >
        <input className="title-input" autoFocus placeholder="שם האתגר" value={name} onChange={(e) => setName(e.target.value)} />
        <section className="card" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="cs">מתחיל</label>
            <input id="cs" type="date" className="mini-input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cd">כמה ימים</label>
            <span className="val">
              <input id="cd" type="number" min={1} className="mini-input" style={{ width: 80 }} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} />
              <span className="muted small">עד {formatDMY(addDays(start, days - 1))}</span>
            </span>
          </div>
        </section>
        <div className="section-title">חוקים</div>
        <section className="card">
          {rules.map((r, i) => (
            <div key={i} className="addrow" style={{ marginTop: i ? 6 : 0 }}>
              <input
                className="input"
                placeholder={`חוק ${i + 1}, למשל "רק מים"`}
                value={r}
                onChange={(e) => {
                  const next = [...rules];
                  next[i] = e.target.value;
                  if (i === rules.length - 1 && e.target.value) next.push('');
                  setRules(next);
                }}
              />
            </div>
          ))}
        </section>
        <button type="submit" className="btn primary block" disabled={!name.trim() || !rules.some((r) => r.trim())}>
          התחל אתגר
        </button>
      </form>
    </div>
  );
}

function ChallengeDetail({ id, today }: { id: string; today: string }) {
  const c = useLive(() => Q.challenge(id), [id]);
  const logs = useLive(() => Q.challengeLogs(id), [id]) ?? [];
  const [ruleText, setRuleText] = useState('');
  const [editing, setEditing] = useState(false);
  if (c === undefined) return <div className="page sub" />;
  if (c === null) {
    return (
      <div className="page sub">
        <TopBar title="אתגר" backTo="/challenges" />
        <Empty icon="🔍">האתגר לא נמצא.</Empty>
      </div>
    );
  }
  const ph = challengePhase(c, today);
  const len = challengeLength(c);
  const days = Array.from({ length: len }, (_, i) => addDays(c.startDate, i));
  const past = days.filter((d) => d <= today);
  const clean = past.filter((d) => dayMark(c, logs, d, today) === 'clean').length;
  const markDate = ph === 'ended' ? c.endDate : today;
  const s = dayStats(c, logs, markDate);
  return (
    <div className="page sub">
      <TopBar title="" backTo="/challenges">
        <button type="button" className="iconbtn" aria-label="ערוך" onClick={() => setEditing(!editing)} style={{ color: editing ? 'var(--blue)' : undefined }}>
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="מחק אתגר"
          onClick={async () => {
            if (!confirmAction(`למחוק את "${c.name}" ואת כל הסימונים שלו?`)) return;
            await deleteChallenge(c.id);
            back('/challenges');
          }}
        >
          <Icon name="trash" />
        </button>
      </TopBar>
      <DraftInput className="title-input" value={c.name} onSave={(v) => void updateChallenge(c.id, { name: v })} />
      <div className="stats3" style={{ margin: '12px 0' }}>
        <div className="stat">
          <div className="k">יום</div>
          <div className="v">
            {ph === 'future' ? 0 : Math.min(challengeDay(c, today), len)}/{len}
          </div>
        </div>
        <div className="stat">
          <div className="k">רצף</div>
          <div className="v">🔥 {streak(c, logs, today)}</div>
        </div>
        <div className="stat">
          <div className="k">ימים נקיים</div>
          <div className="v">{past.length ? Math.round((clean / past.length) * 100) : 0}%</div>
        </div>
      </div>

      {ph !== 'future' && (
        <>
          <div className="section-title">
            <span>{markDate === today ? 'היום' : 'היום האחרון'}</span>
            <span className="num">
              {s.kept}/{s.total}
            </span>
          </div>
          <section className="card">
            <div className="rulegrid">
              {c.rules.map((r) => {
                const v = ruleValue(logs, c.id, markDate, r.id);
                return (
                  <button key={r.id} type="button" className={`rule ${v ?? ''}`} onClick={() => void cycleRule(c.id, markDate, r.id)}>
                    {v === 'kept' ? '✓' : v === 'broken' ? '✕' : ''} {r.title}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      <div className="section-title">היסטוריה</div>
      <section className="card">
        <div className="hist">
          {days.map((d) => (
            <span key={d} className={`${dayMark(c, logs, d, today)} ${d === today ? 'today' : ''}`} title={formatDMY(d)} />
          ))}
        </div>
        <div className="lg" style={{ marginTop: 10 }}>
          <span><i style={{ background: 'var(--blue)' }} />נקי</span>
          <span><i style={{ background: 'var(--blue-light)' }} />חלקי</span>
          <span><i style={{ background: '#f87171' }} />נשבר חוק</span>
          <span><i style={{ background: 'var(--surface2)' }} />לא סומן</span>
        </div>
      </section>

      {editing && (
        <>
          <div className="section-title">עריכה</div>
          <section className="card">
            <div className="field">
              <label htmlFor="es">התחלה</label>
              <input id="es" type="date" className="mini-input" value={c.startDate} onChange={(e) => e.target.value && void updateChallenge(c.id, { startDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ee">סיום</label>
              <input id="ee" type="date" className="mini-input" value={c.endDate} onChange={(e) => e.target.value && void updateChallenge(c.id, { endDate: e.target.value })} />
            </div>
            {c.rules.map((r, i) => (
              <div key={r.id} className="field">
                <DraftInput className="mini-input grow" value={r.title} onSave={(v) => void updateChallenge(c.id, { rules: c.rules.map((x) => (x.id === r.id ? { ...x, title: v } : x)) })} ariaLabel={`חוק ${i + 1}`} />
                <button type="button" className="muted" aria-label="מחק חוק" onClick={() => confirmAction(`למחוק את "${r.title}"?`) && void updateChallenge(c.id, { rules: c.rules.filter((x) => x.id !== r.id) })}>
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            ))}
            <form
              className="addrow"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ruleText.trim()) return;
                void updateChallenge(c.id, { rules: [...c.rules, newRule(ruleText)] });
                setRuleText('');
              }}
            >
              <input className="input" placeholder="+ חוק" value={ruleText} onChange={(e) => setRuleText(e.target.value)} />
            </form>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routines settings (the approved sketch, phone 4)
// ---------------------------------------------------------------------------

export function RoutinesScreen() {
  const settings = useLive(Q.settings);
  const items = useLive(Q.routineItems) ?? [];
  if (!settings) return <div className="page sub" />;
  const r = settings.routines;
  const setR = async (patch: Partial<RoutineSettings>) => {
    const s = await getSettings();
    await updateSettings({ routines: { ...s.routines, ...patch } });
  };
  const time = (label: string, key: keyof RoutineSettings, icon?: string) => (
    <div className="field">
      <label htmlFor={key}>
        {icon && <Icon name={icon} size="sm" />} {label}
      </label>
      <input id={key} type="time" className="mini-input ltr" value={r[key] as string} onChange={(e) => e.target.value && void setR({ [key]: e.target.value })} />
    </div>
  );
  return (
    <div className="page sub">
      <TopBar title="שגרות" backTo="/more" />
      <section className="card">
        <h4>
          <span className="t">
            <Icon name="sunrise" size="sm" /> שגרת בוקר
          </span>
        </h4>
        {time('מתחילה ב-', 'morningStart')}
        {time('יוצא מהבית ב-', 'morningEnd', 'door')}
        <div className="field">
          <span className="lab">שעה אחרת בשישי-שבת</span>
          <Switch label="שישי-שבת" on={r.weekendDifferent} onChange={(v) => void setR({ weekendDifferent: v })} />
        </div>
        {r.weekendDifferent && time('שישי-שבת: יציאה ב-', 'weekendMorningEnd')}
      </section>
      <p className="muted small" style={{ margin: '-4px 4px 12px' }}>
        אחרי שעת היציאה הכרטיס נעלם מדף הבית. מה שלא סומן נספר כ"לא בוצע".
      </p>
      <ItemsCard kind="morning" items={items.filter((i) => i.routine === 'morning').sort((a, b) => a.order - b.order)} />
      <section className="card">
        <h4>
          <span className="t">
            <Icon name="moon" size="sm" /> שגרת ערב
          </span>
        </h4>
        {time('מופיעה מ-', 'eveningStart')}
        {time('עד', 'eveningEnd')}
      </section>
      <ItemsCard kind="evening" items={items.filter((i) => i.routine === 'evening').sort((a, b) => a.order - b.order)} />
    </div>
  );
}

function ItemsCard({ kind, items }: { kind: RoutineKind; items: { id: string; title: string; active: boolean }[] }) {
  const [text, setText] = useState('');
  return (
    <section className="card">
      <h4>
        <span>פריטים ב{ROUTINE_LABEL[kind]}</span>
        <small>{items.length}</small>
      </h4>
      {items.map((it, i) => (
        <div key={it.id} className="field" style={{ minHeight: 44 }}>
          <span className="row grow" style={{ gap: 4 }}>
            <button type="button" className="muted" aria-label="למעלה" disabled={i === 0} onClick={() => void moveRoutineItem(it.id, -1)} style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <Icon name="up" size="sm" />
            </button>
            <button type="button" className="muted" aria-label="למטה" disabled={i === items.length - 1} onClick={() => void moveRoutineItem(it.id, 1)} style={{ opacity: i === items.length - 1 ? 0.3 : 1 }}>
              <Icon name="down" size="sm" />
            </button>
            <DraftInput className="mini-input grow" value={it.title} onSave={(v) => void updateRoutineItem(it.id, { title: v })} ariaLabel="פריט" />
          </span>
          <Switch label="פעיל" on={it.active} onChange={(v) => void updateRoutineItem(it.id, { active: v })} />
          <button type="button" className="muted" aria-label="מחק" onClick={() => confirmAction(`למחוק את "${it.title}"?`) && void deleteRoutineItem(it.id)}>
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      <form
        className="addrow"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void addRoutineItem(kind, text);
          setText('');
        }}
      >
        <input className="input" placeholder="+ הוסף פריט" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recurring tasks (SPEC 3.9)
// ---------------------------------------------------------------------------

export function RecurringListScreen() {
  const list = useLive(Q.recurring) ?? [];
  return (
    <div className="page">
      <TopBar title="משימות חוזרות" backTo="/more">
        <button type="button" className="iconbtn" aria-label="חדשה" onClick={() => go('/recurring/new')}>
          <Icon name="plus" />
        </button>
      </TopBar>
      {!list.length && (
        <Empty icon="🔁">
          משימה חוזרת נוצרת לבד ביום הנכון, למשל "לתת כביסה" כל רביעי. היא מופיעה ב"הקבועים של היום".
          <br />
          <button type="button" className="linkbtn" onClick={() => go('/recurring/new')}>
            <Icon name="plus" size="xs" /> משימה חוזרת
          </button>
        </Empty>
      )}
      {list.length > 0 && (
        <section className="card">
          {list.map((r) => (
            <button key={r.id} type="button" className="listrow" onClick={() => go(`/recurring/${r.id}`)} style={{ opacity: r.active ? 1 : 0.5 }}>
              <span className="ic blue">
                <Icon name="repeat" size="sm" />
              </span>
              <span className="grow">
                {r.title}
                <span className="muted small" style={{ display: 'block' }}>
                  {describeRule(r.rule)}
                  {r.startTime ? ` · ${r.startTime}` : ''}
                  {!r.active ? ' · מושהית' : ''}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

type RuleType = RecurrenceRule['type'];

export function RecurringScreen({ id }: { id: string }) {
  const isNew = id === 'new';
  const existing = useLive(() => (isNew ? Promise.resolve(null) : Q.recurringOne(id)), [id]);
  const { today } = useClock();
  if (!isNew && existing === undefined) return <div className="page sub" />;
  return <RecurringForm key={existing?.id ?? 'new'} existing={existing ?? undefined} today={today} />;
}

function RecurringForm({ existing, today }: { existing?: Recurring; today: string }) {
  const projects = useLive(Q.projects) ?? [];
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<RuleType>(existing?.rule.type ?? 'weekly');
  const [days, setDays] = useState<number[]>(existing?.rule.type === 'weekly' ? existing.rule.days : [new Date().getDay()]);
  const [weeks, setWeeks] = useState(existing?.rule.type === 'interval' ? existing.rule.weeks : 2);
  const [day, setDay] = useState(existing?.rule.type === 'interval' ? existing.rule.day : new Date().getDay());
  const [dom, setDom] = useState(existing?.rule.type === 'monthly' ? existing.rule.dayOfMonth : 1);
  const [startTime, setStartTime] = useState(existing?.startTime ?? '');
  const [duration, setDuration] = useState(existing?.durationMin ?? 30);
  const [projectIds, setProjectIds] = useState<string[]>(existing?.projectIds ?? []);
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [active, setActive] = useState(existing?.active ?? true);
  const [pick, setPick] = useState(false);
  const rule: RecurrenceRule = type === 'daily' ? { type } : type === 'weekly' ? { type, days: days.length ? days : [0] } : type === 'interval' ? { type, weeks, day } : { type, dayOfMonth: dom };
  const save = async () => {
    if (!title.trim()) return;
    await saveRecurring({ id: existing?.id, title: title.trim(), rule, startDate, startTime: startTime || undefined, durationMin: startTime ? duration : undefined, projectIds, active });
    back('/recurring');
  };
  return (
    <div className="page sub">
      <TopBar title={existing ? 'משימה חוזרת' : 'משימה חוזרת חדשה'} backTo="/recurring">
        {existing && (
          <button
            type="button"
            className="iconbtn"
            aria-label="מחק"
            onClick={async () => {
              if (!confirmAction('למחוק את המשימה החוזרת? משימות שכבר נוצרו יישארו.')) return;
              await deleteRecurring(existing.id);
              back('/recurring');
            }}
          >
            <Icon name="trash" />
          </button>
        )}
      </TopBar>
      <input className="title-input" placeholder="למשל: לתת כביסה" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!existing} />
      <div style={{ margin: '12px 0' }}>
        <Seg value={type} onChange={setType} items={[{ id: 'daily', label: 'כל יום' }, { id: 'weekly', label: 'ימים בשבוע' }, { id: 'interval', label: 'כל כמה שבועות' }, { id: 'monthly', label: 'חודשי' }]} />
      </div>
      <section className="card">
        {type === 'weekly' && (
          <div className="chips">
            {HE_DAYS.map((d, i) => (
              <button key={d} type="button" className={`chip ${days.includes(i) ? 'on' : 'out'}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>
                {d}
              </button>
            ))}
          </div>
        )}
        {type === 'interval' && (
          <>
            <div className="field">
              <label htmlFor="rw">כל</label>
              <span className="val">
                <input id="rw" type="number" min={1} className="mini-input" style={{ width: 70 }} value={weeks} onChange={(e) => setWeeks(Math.max(1, Number(e.target.value) || 1))} />
                <span>שבועות</span>
              </span>
            </div>
            <div className="field">
              <label htmlFor="rd">ביום</label>
              <select id="rd" className="mini-input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {HE_DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {type === 'monthly' && (
          <div className="field">
            <label htmlFor="rm">ביום בחודש</label>
            <input id="rm" type="number" min={1} max={31} className="mini-input" style={{ width: 70 }} value={dom} onChange={(e) => setDom(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        )}
        {type === 'daily' && <p className="muted small" style={{ margin: 0 }}>תיווצר משימה כל יום.</p>}
        <p className="small" style={{ margin: '10px 0 0', color: 'var(--blue-text)', fontWeight: 600 }}>
          {describeRule(rule)}
        </p>
      </section>
      <section className="card">
        <div className="field">
          <label htmlFor="rt">שעה (לא חובה)</label>
          <span className="val">
            <input id="rt" type="time" className="mini-input ltr" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            {startTime && (
              <select className="mini-input" aria-label="משך" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} דק׳` : `${m / 60} ש׳`}
                  </option>
                ))}
              </select>
            )}
          </span>
        </div>
        <div className="field">
          <span className="lab">פרויקט</span>
          <button type="button" className="val linkbtn" onClick={() => setPick(true)}>
            {projectIds.length ? projects.filter((p) => projectIds.includes(p.id)).map((p) => p.name).join(', ') : 'בחר'}
          </button>
        </div>
        <div className="field">
          <label htmlFor="rs">מתחילה מ-</label>
          <input id="rs" type="date" className="mini-input" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <span className="lab">פעילה</span>
          <Switch label="פעילה" on={active} onChange={setActive} />
        </div>
      </section>
      <button type="button" className="btn primary block" disabled={!title.trim()} onClick={() => void save()}>
        שמור
      </button>
      <ProjectPicker open={pick} onClose={() => setPick(false)} selected={projectIds} onChange={setProjectIds} />
    </div>
  );
}
