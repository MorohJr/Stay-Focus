import { useState } from 'react';
import { activeChallenge, challengeDay, dayStats, ruleValue, rulesCardVisible, streak } from '../../domain/challenge';
import { dayOfWeek, diffDays, formatLong, formatRelative, HE_DAYS, hhmmOf, weekNumber, weeksInYear, localDate } from '../../domain/dates';
import { focusGoal, goalProgress, projectCompletion } from '../../domain/goals';
import { describeRule } from '../../domain/recurring';
import { routineCard, routineDayStats, itemsOf, ROUTINE_LABEL } from '../../domain/routine';
import type { Project, Task } from '../../domain/schemas';
import { sprintNeedingReview, sprintStatus } from '../../domain/sprints';
import { completion, isInbox } from '../../domain/tasks';
import { DAY_END, DAY_START, dayBlocks, formatDuration, freeMinutes, greeting, moreToday, nextTask, nowCard, overdue, regulars, ring, ringsAverage, top3 } from '../../domain/today';
import { cycleRule, toggleRoutineItem } from '../../services/habits';
import { Q } from '../../services/queries';
import { describeWeather } from '../../services/weather';
import { addToTop3, moveToToday, postponeAllOverdue, postponeTask, removeFromTop3, setStatus, toggleDone } from '../../services/tasks';
import { Bar, Rings } from '../components/common';
import { Icon } from '../components/Icon';
import { Box, PostponeSheet, projectName, TaskPickerSheet } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { go } from '../router';

/** SPEC 4: the approved Today screen, top to bottom. Everything is derived (E5). */
export function TodayScreen() {
  const { today, nowMin } = useClock();
  const tasks = useLive(Q.tasks);
  const projects = useLive(Q.projects) ?? [];
  const sprints = useLive(Q.sprints) ?? [];
  const goals = useLive(Q.goals) ?? [];
  const settings = useLive(Q.settings);
  const routineItems = useLive(Q.routineItems) ?? [];
  const routineLogs = useLive(() => Q.routineLogsFor(today), [today]) ?? [];
  const challenges = useLive(Q.challenges) ?? [];
  const challengeLogs = useLive(Q.allChallengeLogs) ?? [];
  const recurring = useLive(Q.recurring) ?? [];
  const [postpone, setPostpone] = useState<Task | undefined>();
  const [picking, setPicking] = useState(false);

  if (!tasks || !settings) return <div className="page" />;

  const pname = (t: Task) => projectName(t.projectIds, projects);
  const now = nowCard(tasks, today, nowMin);
  const next = nextTask(tasks, today, nowMin);
  const rCard = routineCard(settings.routines, routineItems, routineLogs, today, nowMin);
  const ch = activeChallenge(challenges, today);
  const top = top3(tasks, today);
  const late = overdue(tasks, today);
  const regs = regulars(tasks, today);
  const more = moreToday(tasks, today);
  const goal = focusGoal(goals);
  const hasItems = { morning: itemsOf(routineItems, 'morning').length > 0, evening: itemsOf(routineItems, 'evening').length > 0 };
  const blocks = dayBlocks(tasks, today, settings.routines, hasItems);
  const free = freeMinutes(blocks, nowMin);
  const curSprint = sprints.find((s) => sprintStatus(s, today) === 'current');
  const sprintC = completion(tasks.filter((t) => curSprint && t.sprintId === curSprint.id));
  const rStats = routineDayStats(routineItems, routineLogs, today);
  const chStats = ch ? dayStats(ch, challengeLogs, today) : undefined;
  const rings = [ring(sprintC.done, sprintC.total), ring(rStats.done, rStats.total), ring(chStats?.kept ?? 0, chStats?.total ?? 0)];
  const avg = ringsAverage(rings);
  const inboxCount = tasks.filter(isInbox).length;
  const review = sprintNeedingReview(sprints, today);
  const backupDays = settings.lastBackupAt ? diffDays(localDate(settings.lastBackupAt), today) : undefined;
  const hasData = tasks.length > 0 || projects.length > 0;
  const weather = settings.weather && settings.weatherCache ? describeWeather(settings.weatherCache.code) : undefined;
  const year = Number(today.slice(0, 4));

  return (
    <div className="page">
      {/* R-TOD-10 / R-SPR-4 banners */}
      {review && (
        <button type="button" className="banner dark" style={{ width: '100%', textAlign: 'start' }} onClick={() => go(`/review/${review.id}`)}>
          <Icon name="sprint" />
          <span className="grow">השבוע הסתיים. בוא נסכם את {review.name.split(' · ')[0]} ונעביר את מה שנשאר.</span>
          <Icon name="chev" size="sm" />
        </button>
      )}
      {hasData && (backupDays === undefined || backupDays >= 7) && (
        <button type="button" className="banner warn" style={{ width: '100%', textAlign: 'start' }} onClick={() => go('/backup')}>
          <Icon name="download" size="sm" />
          <span className="grow">{backupDays === undefined ? 'עוד לא גיבית את הנתונים' : `הגיבוי האחרון לפני ${backupDays} ימים`}</span>
          <b>גבה עכשיו</b>
        </button>
      )}

      {/* 1. Header */}
      <div className="hdr">
        <div>
          <div className="date">{formatLong(today)}</div>
          <h1 className="hello">
            {greeting(nowMin)}
            {settings.userName ? `, ${settings.userName}` : ''}
          </h1>
        </div>
        <div className="pills">
          {weather && settings.weatherCache ? (
            <button type="button" className="pill" onClick={() => go('/weather')}>
              <Icon name={weather.icon} size="sm" />
              <span className="num ltr">{settings.weatherCache.tempC}°</span> {weather.text}
            </button>
          ) : (
            <button type="button" className="pill muted" onClick={() => go('/weather')}>
              <Icon name="sun" size="sm" /> מזג אוויר
            </button>
          )}
          <span className="pill">
            <Icon name="cal" size="sm" />
            שבוע <span className="num">{weekNumber(today)}/{weeksInYear(year)}</span>
          </span>
        </div>
      </div>

      {/* 2. Now */}
      {now.kind === 'scheduled' && (
        <div className="hero">
          <div className="k">
            עכשיו · <span className="ltr num">{hhmmOf(now.start)}–{hhmmOf(now.end)}</span>
          </div>
          <button type="button" className="ttl" style={{ display: 'block', textAlign: 'start', color: 'inherit' }} onClick={() => go(`/task/${now.task.id}`)}>
            {now.task.title}
          </button>
          <div className="meta">
            {pname(now.task) ?? 'בלי פרויקט'} · נשארו {formatDuration(now.minutesLeft)}
          </div>
          <div className="prog">
            <i style={{ width: `${now.progress}%` }} />
          </div>
          <div className="btns">
            <button type="button" className="btn-h done" onClick={() => void setStatus(now.task.id, 'done')}>
              <Icon name="check" size="sm" /> סיימתי
            </button>
            <button type="button" className="btn-h" onClick={() => setPostpone(now.task)}>
              <Icon name="snooze" size="sm" /> דחה
            </button>
          </div>
        </div>
      )}
      {now.kind === 'suggestion' && (
        <div className="hero empty">
          <div className="k">אין משהו מתוזמן עכשיו · {now.source === 'top3' ? 'הצעה מ-3 החשובים' : 'הצעה מהמשימות של היום'}</div>
          <button type="button" className="ttl" style={{ display: 'block', textAlign: 'start' }} onClick={() => go(`/task/${now.task.id}`)}>
            {now.task.title}
          </button>
          <div className="meta">{pname(now.task) ?? 'בלי פרויקט'}</div>
          <div className="btns">
            <button type="button" className="btn-h done" onClick={() => void setStatus(now.task.id, 'done')}>
              <Icon name="check" size="sm" /> סיימתי
            </button>
            <button type="button" className="btn-h" onClick={() => setPostpone(now.task)}>
              <Icon name="snooze" size="sm" /> דחה
            </button>
          </div>
        </div>
      )}
      {now.kind === 'empty' && (
        <div className="hero empty">
          <div className="k">עכשיו</div>
          <div className="ttl">{now.hasLater ? 'זמן פנוי עכשיו' : 'הכול נקי להיום 🎉'}</div>
          <div className="meta">{now.hasLater && next ? `המשימה הבאה מתוזמנת ל-${next.startTime}.` : 'אין משימות פתוחות להיום.'}</div>
          <div className="btns">
            <button type="button" className="btn-h done" onClick={() => setPicking(true)}>
              <Icon name="plus" size="sm" /> בחר משימה להיום
            </button>
          </div>
        </div>
      )}

      {/* 3. Next */}
      {next && (
        <button type="button" className="card nextcard" onClick={() => go(`/task/${next.id}`)}>
          <Icon name="clock" size="sm" />
          <span>
            הבא: <b>{next.title}</b>
          </span>
          <span className="when ltr num">{next.startTime}</span>
        </button>
      )}

      {/* 4. Routine (R-RTN-1..5) */}
      {rCard && (
        <section className="card">
          {rCard.complete ? (
            <div className="done-line">
              <Icon name={rCard.window.kind === 'morning' ? 'sunrise' : 'moon'} size="sm" />
              {ROUTINE_LABEL[rCard.window.kind]} הושלמה ✓
            </div>
          ) : (
            <>
              <h4>
                <span className="t">
                  <Icon name={rCard.window.kind === 'morning' ? 'sunrise' : 'moon'} size="sm" /> {ROUTINE_LABEL[rCard.window.kind]}
                </span>
                <small className="num">
                  {rCard.done}/{rCard.total}
                </small>
              </h4>
              <div className="chips">
                {rCard.items.map(({ item, done }) => (
                  <button key={item.id} type="button" className={`chip ${done ? 'ok' : ''}`} aria-pressed={done} onClick={() => void toggleRoutineItem(today, item.id)}>
                    {done && '✓ '}
                    {item.title}
                  </button>
                ))}
              </div>
              <div className="rbar">
                <i style={{ width: `${Math.round((rCard.done / rCard.total) * 100)}%` }} />
              </div>
              <div className="rhint">
                <Icon name="clock" size="xs" /> מוצג עד {rCard.window.end}
                {rCard.window.kind === 'morning' ? ' (יציאה מהבית)' : ''}
              </div>
            </>
          )}
        </section>
      )}

      {/* 5. Challenge rules (R-CHL-2) */}
      {ch && rulesCardVisible(ch, challengeLogs, today) && (
        <section className="card">
          <h4>
            <button type="button" className="t" onClick={() => go(`/challenge/${ch.id}`)}>
              <Icon name="shield" size="sm" /> {ch.name} · יום {challengeDay(ch, today)}
            </button>
            <small className="num">
              {chStats!.marked}/{chStats!.total} · 🔥 {streak(ch, challengeLogs, today)}
            </small>
          </h4>
          <div className="rulegrid">
            {ch.rules.map((r) => {
              const v = ruleValue(challengeLogs, ch.id, today, r.id);
              return (
                <button key={r.id} type="button" className={`rule ${v ?? ''}`} onClick={() => void cycleRule(ch.id, today, r.id)}>
                  {v === 'kept' ? '✓' : v === 'broken' ? '✕' : ''} {r.title}
                </button>
              );
            })}
          </div>
          <div className="rhint">לחיצה: שמרתי ✓, לחיצה נוספת: לא שמרתי ✕</div>
        </section>
      )}

      {/* 6. Top 3 (R-TOD-4) */}
      <section className="card">
        <h4>
          <span>3 החשובים היום</span>
          <small className="num">{top.filter((t) => t.status === 'done').length} מתוך 3</small>
        </h4>
        {top.map((t) => (
          <div key={t.id} className={`todo ${t.status === 'done' ? 'done' : ''}`}>
            <Box status={t.status} onClick={() => void toggleDone(t.id)} label={`סמן ${t.title}`} />
            <button type="button" className="txt" onClick={() => go(`/task/${t.id}`)}>
              {t.title}
              {t.startTime && <span className="sub ltr">{t.startTime}</span>}
            </button>
            {pname(t) && <span className="tag">{pname(t)}</span>}
            <button type="button" className="muted" aria-label="הסר מ-3 החשובים" onClick={() => void removeFromTop3(t.id)} style={{ padding: 4 }}>
              <Icon name="x" size="xs" />
            </button>
          </div>
        ))}
        {top.length < 3 && (
          <button type="button" className="slotbtn" onClick={() => setPicking(true)}>
            <span className="dash">
              <Icon name="plus" size="xs" />
            </span>
            בחר משימה ({3 - top.length} מקומות פנויים)
          </button>
        )}
      </section>

      {/* 7. Overdue (R-TOD-5) */}
      {late.length > 0 && (
        <section className="card late">
          <h4>
            <span className="t" style={{ color: 'var(--warn)' }}>
              <Icon name="alert" size="sm" /> באיחור
            </span>
            <small className="num">{late.length}</small>
          </h4>
          {late.map((t) => (
            <div key={t.id} className="lrow">
              <button type="button" className="grow" style={{ textAlign: 'start' }} onClick={() => go(`/task/${t.id}`)}>
                {t.title}
              </button>
              <span className="d">{formatRelative(t.dueDate!, today)}</span>
              <span className="acts">
                <button type="button" className="minibtn p" onClick={() => void moveToToday(t.id, today)}>
                  להיום
                </button>
                <button type="button" className="minibtn" onClick={() => void postponeTask(t.id, 'tomorrow', today)}>
                  דחה
                </button>
              </span>
            </div>
          ))}
          {late.length > 1 && (
            <div className="all">
              <button type="button" className="minibtn" onClick={() => void postponeAllOverdue(today)}>
                דחה הכול למחר
              </button>
            </div>
          )}
        </section>
      )}

      {/* 8. Regulars (R-TOD-6) */}
      {regs.length > 0 && (
        <section className="card">
          <h4>
            <span className="t">
              <Icon name="repeat" size="sm" /> הקבועים של {HE_DAYS[dayOfWeek(today)]}
            </span>
            <small className="num">
              {regs.filter((t) => t.status === 'done').length}/{regs.length}
            </small>
          </h4>
          {regs.map((t) => {
            const r = recurring.find((x) => x.id === t.recurringId);
            return (
              <div key={t.id} className={`todo ${t.status === 'done' ? 'done' : ''}`}>
                <Box status={t.status} onClick={() => void toggleDone(t.id)} label={`סמן ${t.title}`} />
                <button type="button" className="txt" onClick={() => go(`/task/${t.id}`)}>
                  {t.title}
                  {t.startTime && <span className="sub ltr">{t.startTime}</span>}
                </button>
                {r && (
                  <span className="rep">
                    <Icon name="repeat" size="xs" /> {describeRule(r.rule)}
                  </span>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 9. More today (R-TOD-7) */}
      <section className="card more">
        <h4>
          <span>עוד להיום</span>
          <small className="num">{more.filter((t) => t.status !== 'done').length}</small>
        </h4>
        {more.map((t) => (
          <div key={t.id} className={`mrow ${t.status === 'done' ? 'done' : ''}`}>
            <button type="button" className="sq" aria-label={`סמן ${t.title}`} onClick={() => void toggleDone(t.id)}>
              {t.status === 'done' && <Icon name="check" />}
            </button>
            <button type="button" className="txt grow" style={{ textAlign: 'start' }} onClick={() => go(`/task/${t.id}`)}>
              {t.title}
            </button>
            <span className="meta">
              {t.startTime ? <span className="ltr num">{t.startTime}</span> : pname(t) ?? ''}
              {top.length < 3 && t.status !== 'done' && (
                <button type="button" aria-label="ל-3 החשובים" title="ל-3 החשובים" onClick={() => void addToTop3(t.id, today)} style={{ marginInlineStart: 6, color: 'var(--muted)' }}>
                  <Icon name="up" size="xs" />
                </button>
              )}
            </span>
          </div>
        ))}
        {more.length === 0 && <p className="muted small" style={{ margin: '0 4px' }}>אין עוד משימות להיום.</p>}
        <button type="button" className="addline" onClick={() => go('/new-task/today')}>
          <Icon name="plus" size="sm" /> הוסף משימה להיום
        </button>
      </section>

      {/* 10. Goal in focus */}
      <GoalCard goal={goal} projects={projects} tasks={tasks} />

      {/* 11. Day strip (R-TOD-8) */}
      <section className="card">
        <h4>
          <span className="t">
            <Icon name="clock" size="sm" /> היום שלך
          </span>
          <small>{blocks.filter((b) => b.kind !== 'routine').length} מתוזמנים</small>
        </h4>
        <div className="strip">
          {blocks.map((b, i) => (
            <b
              key={i}
              className={`${b.kind} ${b.open ? '' : 'closed'}`}
              title={`${b.title} ${hhmmOf(b.start)}–${hhmmOf(b.end)}`}
              style={{ right: `${((Math.max(b.start, DAY_START) - DAY_START) / (DAY_END - DAY_START)) * 100}%`, width: `${((Math.min(b.end, DAY_END) - Math.max(b.start, DAY_START)) / (DAY_END - DAY_START)) * 100}%` }}
            />
          ))}
          {nowMin >= DAY_START && <span className="now" style={{ right: `${((nowMin - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />}
        </div>
        <div className="hours">
          {[24, 21, 18, 15, 12, 9, 6].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <div className="lg">
          <span>
            <i style={{ background: 'rgba(17,17,17,.16)' }} />
            שגרה
          </span>
          <span>
            <i style={{ background: 'var(--blue)' }} />3 החשובים
          </span>
          <span>
            <i style={{ background: '#111' }} />
            משימות
          </span>
        </div>
        <div className="free">
          <Icon name="clock" size="sm" /> נשארו היום <b className="num">{formatDuration(free)}</b> פנויות
        </div>
      </section>

      {/* 12. Rings (R-TOD-9) */}
      <section className="card">
        <h4>
          <span>ההתקדמות שלי</span>
          <small>היום</small>
        </h4>
        <div className="rings">
          <div className="ringwrap">
            <Rings rings={[{ pct: rings[0]!.pct, color: 'var(--blue)' }, { pct: rings[1]!.pct, color: 'var(--ink)' }, { pct: rings[2]!.pct, color: 'var(--blue-light)' }]} />
            <div className="c">
              <div className="num" style={{ fontSize: 19, fontWeight: 800 }}>
                {avg === null ? '—' : `${avg}%`}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                ממוצע
              </div>
            </div>
          </div>
          <div className="legend">
            <button type="button" style={{ textAlign: 'start' }} onClick={() => go('/sprint')}>
              <b>
                <i style={{ background: 'var(--blue)' }} />
                ספרינט
              </b>
              <div className="muted num">{sprintC.total ? <><span className="ltr">{sprintC.done}/{sprintC.total}</span> · <span className="ltr">{rings[0]!.pct}%</span></> : 'אין משימות בספרינט'}</div>
            </button>
            <button type="button" style={{ textAlign: 'start' }} onClick={() => go('/routines')}>
              <b>
                <i style={{ background: 'var(--ink)' }} />
                שגרה היום
              </b>
              <div className="muted num">{rStats.total ? <><span className="ltr">{rStats.done}/{rStats.total}</span> · <span className="ltr">{rings[1]!.pct}%</span></> : 'אין פריטי שגרה'}</div>
            </button>
            <button type="button" style={{ textAlign: 'start' }} onClick={() => go(ch ? `/challenge/${ch.id}` : '/challenges')}>
              <b>
                <i style={{ background: 'var(--blue-light)' }} />
                חוקי האתגר
              </b>
              <div className="muted num">{ch && chStats ? <><span className="ltr">{chStats.kept}/{chStats.total}</span> · 🔥 {streak(ch, challengeLogs, today)} ימים</> : 'אין אתגר פעיל'}</div>
            </button>
          </div>
        </div>
      </section>

      {/* 13. Inbox */}
      <button type="button" className="card nextcard" onClick={() => go('/tasks/inbox')}>
        <Icon name="inbox" size="sm" />
        <span>{inboxCount ? <><b className="num">{inboxCount}</b> פריטים בדואר הנכנס</> : 'הדואר הנכנס ריק'}</span>
        <span className="when linkbtn">
          {inboxCount ? 'לסדר' : 'פתח'} <Icon name="chev" size="xs" />
        </span>
      </button>

      <PostponeSheet task={postpone} onClose={() => setPostpone(undefined)} />
      <TaskPickerSheet
        open={picking}
        title="בחר משימה ל-3 החשובים"
        exclude={top.map((t) => t.id)}
        onClose={() => setPicking(false)}
        onPick={async (t) => {
          await addToTop3(t.id, today);
          setPicking(false);
        }}
      />
    </div>
  );
}

function GoalCard({ goal, projects, tasks }: { goal: ReturnType<typeof focusGoal>; projects: Project[]; tasks: Task[] }) {
  if (!goal) {
    return (
      <button type="button" className="card goal" style={{ width: '100%', textAlign: 'start' }} onClick={() => go('/goal/new')}>
        <h4>
          <span className="t">
            <Icon name="mountain" size="sm" /> מטרה בפוקוס
          </span>
        </h4>
        <div className="muted small">עוד אין מטרה גדולה. הגדר מטרה, וחבר אליה פרויקטים כדי לראות כמה התקדמת.</div>
        <div className="linkbtn" style={{ marginTop: 8 }}>
          <Icon name="plus" size="xs" /> מטרה חדשה
        </div>
      </button>
    );
  }
  const pct = goalProgress(goal, projects, tasks);
  const linked = projects.filter((p) => p.goalId === goal.id && p.status !== 'archived');
  return (
    <button type="button" className="card goal" style={{ width: '100%', textAlign: 'start', display: 'block' }} onClick={() => go(`/goal/${goal.id}`)}>
      <h4>
        <span className="t">
          <Icon name="mountain" size="sm" /> מטרה בפוקוס
        </span>
        {goal.targetDate && <small>עד {goal.targetDate.slice(5, 7)}/{goal.targetDate.slice(0, 4)}</small>}
      </h4>
      <div className="gt">{goal.title}</div>
      <Bar pct={pct} thick />
      <div className="sub2">
        <span>
          <span className="num ltr">{pct}%</span> · {goal.progressMode === 'manual' ? 'עדכון ידני' : `${linked.length} פרויקטים`}
        </span>
      </div>
      {linked.length > 0 && (
        <div className="projs">
          {linked.map((p) => (
            <span key={p.id}>
              {p.name} <b className="ltr">{projectCompletion(p, tasks).pct}%</b>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
