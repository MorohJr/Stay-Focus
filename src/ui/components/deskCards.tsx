import { useMemo } from 'react';
import { dayOfWeek, formatDMY, HE_DAYS, HE_DAYS_SHORT } from '../../domain/dates';
import { burndown, challengeLanes, dailyTrend, routineMatrix, sprintHistory, taskFlow } from '../../domain/desktopCharts';
import type { Challenge, ChallengeLog, RoutineItem, RoutineLog, Sprint, Task } from '../../domain/schemas';
import { useRich } from '../design';
import { ChartHead, HeatMatrix, LinePlot, Lollipops, MirrorBars, StreakLanes } from './deskCharts';

/** R-DSK-4: the desktop-only chart cards. Each shows only in the glass look from 1024px, and only when it has data. */

const dm = (d: string) => formatDMY(d).slice(0, 5);

/** Today: "my trend", a smooth line of the last 30 days against the 30 before. */
export function TrendCard({ tasks, today }: { tasks: Task[]; today: string }) {
  const rich = useRich();
  const t = useMemo(() => dailyTrend(tasks, today), [tasks, today]);
  if (!rich || (!t.total && !t.prevTotal)) return null;
  return (
    <section className="card dchart">
      <ChartHead title="המגמה שלי · 30 ימים" value={t.total} unit={`משימות הושלמו · ממוצע ${t.avg} ליום`} change={t.change} note={t.prevTotal ? `מול ${t.prevTotal} ב-30 הימים שלפני` : undefined} />
      <LinePlot
        series={[
          { name: '30 הימים האחרונים', values: t.days.map((d) => d.count), color: 'var(--blue)', area: true },
          { name: '30 הימים שלפני', values: t.days.map((d) => d.prev), color: 'var(--ink)', dashed: true },
        ]}
        labels={t.days.map((d) => dm(d.date))}
        titles={t.days.map((d) => `יום ${HE_DAYS[dayOfWeek(d.date)]}, ${dm(d.date)}`)}
        unit="משימות שהושלמו"
        labelEvery={5}
        height={230}
      />
    </section>
  );
}

/** Sprint: completion of the last sprints as lollipops, and this week's burndown as steps. */
export function SprintCharts({ sprints, tasks, today, cur }: { sprints: Sprint[]; tasks: Task[]; today: string; cur?: Sprint }) {
  const rich = useRich();
  const h = useMemo(() => sprintHistory(sprints, tasks, today), [sprints, tasks, today]);
  const b = useMemo(() => (cur ? burndown(cur, tasks, today) : undefined), [cur, tasks, today]);
  if (!rich || (!h.rows.length && !b?.total)) return null;
  const left = b?.days.filter((d) => d.left !== undefined).at(-1)?.left;
  return (
    <div className="dc-pair">
      {h.rows.length > 0 && (
        <section className="card dchart">
          <ChartHead title="היסטוריית ספרינטים" value={`${h.avg}%`} unit={`ממוצע השלמה ב-${h.rows.length} ספרינטים`} />
          <Lollipops avg={h.avg} rows={h.rows.map((r) => ({ label: r.name.split(' · ')[0]!.replace('שבוע ', ''), title: r.name.split(' · ')[0]!, pct: r.pct, sub: `${r.done} מתוך ${r.total} משימות${r.current ? ' · השבוע' : ''}`, hi: r.current }))} />
        </section>
      )}
      {b && b.total > 0 && (
        <section className="card dchart">
          <ChartHead title="ירידה השבוע" value={left ?? b.total} unit={`משימות פתוחות מתוך ${b.total}`} />
          <LinePlot
            series={[
              { name: 'נשארו פתוחות', values: b.days.map((d) => d.left), color: 'var(--deep)', step: true, area: true },
              { name: 'הקצב הרצוי', values: b.days.map((d) => d.ideal), color: 'var(--sand2)', dashed: true },
            ]}
            labels={b.days.map((d) => HE_DAYS_SHORT[dayOfWeek(d.date)]!)}
            titles={b.days.map((d) => `יום ${HE_DAYS[dayOfWeek(d.date)]}, ${dm(d.date)}`)}
            unit="משימות בסוף היום"
            height={260}
          />
        </section>
      )}
    </div>
  );
}

/** Tasks: added vs done per week, as mirror bars. */
export function FlowCard({ tasks, today }: { tasks: Task[]; today: string }) {
  const rich = useRich();
  const f = useMemo(() => taskFlow(tasks, today), [tasks, today]);
  if (!rich || (!f.added && !f.done)) return null;
  const diff = f.added - f.done;
  return (
    <section className="card dchart" style={{ marginTop: 16 }}>
      <ChartHead title="נכנס מול יוצא · 12 שבועות" value={f.done} unit={`הושלמו מול ${f.added} שנוספו`} note={diff > 0 ? `הרשימה גדלה ב-${diff}` : diff < 0 ? `הרשימה קטנה ב-${-diff}` : 'הרשימה נשארה באותו גודל'} />
      <MirrorBars rows={f.rows.map((r) => ({ label: dm(r.from), title: `${dm(r.from)}–${dm(r.to)}`, added: r.added, done: r.done, open: r.open }))} />
    </section>
  );
}

/** Routines: 30 days as a heat matrix. */
export function RoutineCard({ items, logs, today }: { items: RoutineItem[]; logs: RoutineLog[]; today: string }) {
  const rich = useRich();
  const m = useMemo(() => routineMatrix(items, logs, today), [items, logs, today]);
  if (!rich || !m.rows.length) return null;
  const days = m.pct.filter((p): p is number => p !== null);
  const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
  return (
    <section className="card dchart dwide">
      <ChartHead title="30 ימים של שגרה" value={`${avg}%`} unit="מהפריטים סומנו בממוצע" note={`${m.pct.filter((p) => p === 100).length} ימים מלאים`} />
      <HeatMatrix dates={m.dates} rows={m.rows} pct={m.pct} />
    </section>
  );
}

/** Challenges: streak lanes over the last 60 days. */
export function StreaksCard({ challenges, logs, today }: { challenges: Challenge[]; logs: ChallengeLog[]; today: string }) {
  const rich = useRich();
  const s = useMemo(() => challengeLanes(challenges, logs, today), [challenges, logs, today]);
  if (!rich || !s.lanes.length) return null;
  return (
    <section className="card dchart dwide">
      <ChartHead title="רצפים · 60 ימים" value={Math.max(...s.lanes.map((l) => l.longest))} unit="ימים: הרצף הנקי הארוך" />
      <StreakLanes dates={s.dates} lanes={s.lanes} />
    </section>
  );
}
