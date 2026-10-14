import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDMY, HE_DAYS, HE_DAYS_SHORT, HE_MONTHS, localDate } from '../../domain/dates';
import { completion } from '../../domain/tasks';
import { sprintStatus } from '../../domain/sprints';
import { DAY_PART_LABEL, completedIn, yearsWithData, yearSummary, type DayPart, type EventKind, type TimelineMonth, type YearInput } from '../../domain/yearReview';
import { Q } from '../../services/queries';
import { markYearSeen, saveYearAnswers } from '../../services/yearReview';
import { Bars, Gantt, Heatmap, HBars } from '../components/charts';
import { Empty, Seg, Tabs, TopBar } from '../components/common';
import { DraftTextarea } from '../components/edit';
import { Icon } from '../components/Icon';
import { ProjectIcon } from '../components/ProjectIcon';
import { useClock, useLive } from '../hooks';
import { go, replace } from '../router';

/** Everything the summary is computed from (R-YIR-2). */
function useYearInput(): YearInput | undefined {
  const tasks = useLive(Q.tasks);
  const projects = useLive(Q.projects);
  const goals = useLive(Q.goals);
  const milestones = useLive(Q.milestones);
  const challenges = useLive(Q.challenges);
  const challengeLogs = useLive(Q.allChallengeLogs);
  const sprints = useLive(Q.sprints);
  const routineItems = useLive(Q.routineItems);
  const routineLogs = useLive(Q.routineLogs);
  const notes = useLive(Q.notes);
  const people = useLive(Q.people);
  const agenda = useLive(Q.agenda);
  const areas = useLive(Q.areas);
  if (!tasks || !projects || !goals || !milestones || !challenges || !challengeLogs || !sprints || !routineItems || !routineLogs || !notes || !people || !agenda || !areas) return undefined;
  return { tasks, projects, goals, milestones, challenges, challengeLogs, sprints, routineItems, routineLogs, notes, people, agenda, areas };
}

// ---------------------------------------------------------------------------
// R-YIR-2: the summary of one year
// ---------------------------------------------------------------------------

export function YearScreen({ year: param }: { year?: string }) {
  const { today } = useClock();
  const input = useYearInput();
  const year = Number(param) || Number(today.slice(0, 4));
  const review = useLive(() => Q.yearReview(year), [year]);
  const s = useMemo(() => (input ? yearSummary(input, year, today) : undefined), [input, year, today]);
  const years = useMemo(() => (input ? yearsWithData(input, today) : [year]), [input, today, year]);
  useEffect(() => {
    void markYearSeen(year); // R-YIR-1
  }, [year]);
  if (!s || !input) return <div className="page sub" />;
  const k = s.kpi;

  return (
    <div className="page sub year">
      <TopBar
        title={`${year} במבט לאחור`}
        sub={s.partial ? `עד היום, ${formatDMY(today)}` : 'השנה כולה, 1/1 עד 31/12'}
        backTo="/summaries"
        stats={[
          { v: k.tasks, k: 'משימות הושלמו' },
          { v: k.projects, k: 'פרויקטים הושלמו' },
          { v: k.activeDays, k: 'ימים פעילים' },
        ]}
      >
        <button type="button" className="iconbtn hbtn" aria-label="הדפס או שמור כ-PDF" onClick={() => window.print()}>
          <Icon name="printer" />
        </button>
      </TopBar>
      {years.length > 1 && <Tabs value={String(year)} onChange={(y) => replace(`/year/${y}`)} items={years.map((y) => ({ id: String(y), label: y === Number(today.slice(0, 4)) ? `${y} (עד עכשיו)` : String(y) }))} />}

      {k.tasks === 0 && !s.timeline.length ? (
        <Empty icon="chart">עוד אין משימות שהושלמו ב-{year}. הסיכום יתמלא ככל שתתקדם.</Empty>
      ) : (
        <>
          {/* 2. KPIs */}
          <Section title="במספרים">
            <div className="kpis">
              <Kpi k="משימות שהושלמו" v={k.tasks} sub={k.change !== null ? <Change pct={k.change} /> : undefined} />
              <Kpi k="פרויקטים שהושלמו" v={k.projects} />
              <Kpi k="אבני דרך" v={k.milestones} />
              <Kpi k="מטרות שהושגו" v={k.goals} />
              <Kpi k="ימים פעילים" v={k.activeDays} />
              <Kpi k="הרצף הארוך" v={k.longestStreak} sub="ימים ברצף" />
              <Kpi k="ממוצע ליום פעיל" v={k.perDay} sub="משימות" />
              <Kpi k="בזמן" v={k.onTime === null ? '—' : `${k.onTime}%`} sub="עד התאריך שנקבע" />
            </div>
          </Section>

          {/* 3. Highlights */}
          {s.highlights.length > 0 && (
            <Section title="רגעי שיא">
              <div className="highlights">
                {s.highlights.map((h) => (
                  <div key={h.text} className="hl">
                    <span className="hl-ic">
                      <Icon name={h.icon} size="sm" />
                    </span>
                    {h.text}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 4. By month */}
          <Section title="משימות שהושלמו בכל חודש" note={s.prevMonths ? `הקו הדק: ${year - 1}` : undefined}>
            <Bars
              values={s.months}
              ghost={s.prevMonths}
              labels={HE_MONTHS.map((m) => m.slice(0, 3))}
              highlight={s.months.indexOf(Math.max(...s.months))}
              unit="משימות"
              describe={(i) => `${HE_MONTHS[i]} ${year}`}
            />
          </Section>

          {/* 5. Heatmap */}
          <Section title="השנה, יום אחרי יום">
            <Heatmap year={year} daily={s.daily} today={today} />
          </Section>

          {/* 6. When I work */}
          <Section title="מתי אני עובד">
            <Bars values={s.weekdays} labels={HE_DAYS_SHORT} highlight={s.weekdays.indexOf(Math.max(...s.weekdays))} unit="משימות" describe={(i) => `יום ${HE_DAYS[i]}`} />
            <HBars rows={(Object.keys(DAY_PART_LABEL) as DayPart[]).map((p) => ({ key: p, label: DAY_PART_LABEL[p], value: s.parts[p], pct: k.tasks ? Math.round((s.parts[p] / k.tasks) * 100) : 0 }))} />
          </Section>

          {/* 7. Projects along the year */}
          {s.spans.length > 0 && (
            <Section title="פרויקטים לאורך השנה" note="פס מלא = הושלם">
              <Gantt
                spans={s.spans}
                year={year}
                today={today}
                onOpen={(id) => go(`/project/${id}`)}
                icon={(sp) => <ProjectIcon project={{ icon: sp.icon, logoId: sp.logoId }} size={18} radius={5} />}
              />
            </Section>
          )}

          {/* 8. By area */}
          {s.areas.length > 0 && (
            <Section title="לפי תחום">
              <HBars rows={s.areas.map((a) => ({ key: a.id || 'none', label: <><i className="dot" style={{ background: a.color }} /> {a.name}</>, value: a.count, pct: a.pct, color: a.color }))} />
            </Section>
          )}

          {/* 9. Timeline */}
          <Timeline months={s.timeline} />

          {/* 10. Habits and weeks */}
          <Section title="הרגלים ושבועות">
            <div className="kpis">
              <Kpi k="ספרינטים" v={s.sprints.count} sub={s.sprints.avgPct !== null ? `ממוצע ${s.sprints.avgPct}% הושלמו` : undefined} />
              <Kpi k="שגרות" v={s.routine === null ? '—' : `${s.routine}%`} sub="מהפריטים סומנו" />
              <Kpi k="אתגרים" v={s.challenges.count} sub={s.challenges.count ? `${s.challenges.cleanDays} ימים נקיים` : undefined} />
              <Kpi k="רצף נקי ארוך" v={s.challenges.longest} sub="ימים" />
            </div>
          </Section>

          {/* 11. People and notes */}
          <Section title="אנשים ופתקים">
            <div className="kpis">
              <Kpi k="פתקים" v={s.social.notes} sub={s.social.notes ? `${s.social.ideas} רעיונות · ${s.social.meetings} פגישות` : undefined} />
              <Kpi k="אנשים חדשים" v={s.social.people} />
              <Kpi k="נושאים שדיברנו" v={s.social.talks} />
            </div>
          </Section>
        </>
      )}

      {/* 12. My review */}
      <Section title="הסיכום שלי">
        <div className="card boxed reflect">
          <label>מה הלך טוב השנה?</label>
          <DraftTextarea rows={3} value={review?.wins ?? ''} onSave={(v) => void saveYearAnswers(year, { wins: v })} placeholder="ההצלחות, הרגעים הטובים…" />
          <label>מה לקחתי מהשנה?</label>
          <DraftTextarea rows={3} value={review?.lessons ?? ''} onSave={(v) => void saveYearAnswers(year, { lessons: v })} placeholder="מה הייתי עושה אחרת…" />
          <label>מה הפוקוס ל-{year + 1}?</label>
          <DraftTextarea rows={2} value={review?.nextFocus ?? ''} onSave={(v) => void saveYearAnswers(year, { nextFocus: v })} placeholder="מילה אחת, או משפט" />
          <button type="button" className="btn primary block no-print" onClick={() => go('/projects/goals')}>
            <Icon name="mountain" size="sm" /> הגדר מטרה ל-{year + 1}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ysec">
      <div className="section-title">
        <span>{title}</span>
        {note && <span className="muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-k">{k}</div>
      <div className="kpi-v num">{v}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

function Change({ pct }: { pct: number }) {
  return <span className={`tag ${pct >= 0 ? 'ok' : 'red'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% מהשנה הקודמת</span>;
}

// ---------------------------------------------------------------------------
// R-YIR-2 step 9: month by month
// ---------------------------------------------------------------------------

const KIND: Record<EventKind, { icon: string; label: string }> = {
  project: { icon: 'target', label: 'פרויקט הושלם' },
  goal: { icon: 'mountain', label: 'מטרה הושגה' },
  milestone: { icon: 'milestone', label: 'אבן דרך' },
  challenge: { icon: 'shield', label: 'אתגר הסתיים' },
};
const EVENT_PATH: Record<EventKind, string> = { project: '/project/', goal: '/goal/', milestone: '/project/', challenge: '/challenge/' };

function Timeline({ months }: { months: TimelineMonth[] }) {
  const [filter, setFilter] = useState<'all' | 'big' | 'tasks'>('all');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!months.length) return null;
  return (
    <Section title="טיימליין">
      <div className="no-print" style={{ marginBottom: 10 }}>
        <Seg value={filter} onChange={setFilter} items={[{ id: 'all', label: 'הכול' }, { id: 'big', label: 'פרויקטים ויעדים' }, { id: 'tasks', label: 'משימות' }]} />
      </div>
      <ol className="tl">
        {months.map((m) => {
          const events = filter === 'tasks' ? [] : m.events;
          const tasks = filter === 'big' ? [] : m.tasks;
          if (!events.length && !tasks.length) return null;
          const shown = open[m.month] ? tasks : tasks.slice(0, 5);
          return (
            <li key={m.month} className="tl-month">
              <div className="tl-h">
                <b>{HE_MONTHS[m.month - 1]}</b>
                <span className="muted small">
                  {m.tasks.length} משימות{m.events.length ? ` · ${m.events.length} אירועים` : ''}
                </span>
              </div>
              {events.map((e) => (
                <button key={`${e.kind}-${e.refId}-${e.date}`} type="button" className="tl-ev" onClick={() => go(EVENT_PATH[e.kind] + e.refId)}>
                  <span className={`tl-dot ${e.kind}`}>{e.icon ?? <Icon name={KIND[e.kind].icon} size="xs" />}</span>
                  <span className="grow">
                    <b>{e.title}</b>
                    <small className="muted">
                      {KIND[e.kind].label} · {formatDMY(e.date)}
                    </small>
                  </span>
                </button>
              ))}
              {shown.map((t) => (
                <button key={t.id} type="button" className="tl-task" onClick={() => go(`/task/${t.id}`)}>
                  <span className="sdot done">
                    <Icon name="check" size="xs" />
                  </span>
                  <span className="grow ellipsis">{t.title}</span>
                  <small className="muted num">{formatDMY(localDate(t.completedAt!)).slice(0, 5)}</small>
                </button>
              ))}
              {tasks.length > 5 && (
                <button type="button" className="linkbtn tl-more no-print" onClick={() => setOpen({ ...open, [m.month]: !open[m.month] })}>
                  {open[m.month] ? 'הצג פחות' : `עוד ${tasks.length - 5} משימות`}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// R-YIR-3: all summaries
// ---------------------------------------------------------------------------

export function SummariesScreen() {
  const { today } = useClock();
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const years = yearsWithData({ tasks, projects }, today);
  const weeks = [...sprints].filter((s) => s.startDate <= today && sprintStatus(s, today) !== 'current').reverse();
  const thisYear = Number(today.slice(0, 4));
  return (
    <div className="page">
      <TopBar title="סיכומים" backTo="/more" stats={[{ v: years.length, k: 'שנים' }, { v: weeks.length, k: 'שבועות' }]} />
      <div className="section-title">
        <span>סיכומים שנתיים</span>
      </div>
      <section className="card">
        {years.map((y) => {
          const n = completedIn(tasks, y).length;
          const p = projects.filter((x) => x.doneAt && localDate(x.doneAt).startsWith(String(y))).length;
          return (
            <button key={y} type="button" className="listrow" onClick={() => go(`/year/${y}`)}>
              <span className="ic blue">
                <Icon name="chart" size="sm" />
              </span>
              <span className="grow">
                <b className="num">{y}</b> {y === thisYear && <span className="tag g">עד עכשיו</span>}
                <span className="muted small" style={{ display: 'block' }}>
                  {n} משימות · {p} פרויקטים הושלמו
                </span>
              </span>
              <span className="end">
                <Icon name="chev" size="xs" />
              </span>
            </button>
          );
        })}
      </section>
      <div className="section-title">
        <span>סיכומים שבועיים</span>
        <span className="num">{weeks.length}</span>
      </div>
      {!weeks.length && <Empty icon="sprint">אחרי השבוע הראשון יופיע כאן הסיכום שלו.</Empty>}
      {weeks.length > 0 && (
        <section className="card">
          {weeks.map((s) => {
            const c = completion(tasks.filter((t) => t.sprintId === s.id && !t.parentId));
            return (
              <button key={s.id} type="button" className="prow" onClick={() => go(`/sprint-view/${s.id}`)}>
                <span className="grow">
                  <span className="name">{s.name}</span>
                  <span className="m">
                    {c.done}/{c.total} הושלמו
                    {s.reviewedAt && <span className="tag ok">סוכם</span>}
                    {s.weeklyGoals.length > 0 && <span className="ellipsis">· {s.weeklyGoals.join(' · ')}</span>}
                  </span>
                </span>
                <span className="minibar">
                  <i style={{ width: `${c.pct}%` }} />
                </span>
                <span className="pct">{c.pct}%</span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
