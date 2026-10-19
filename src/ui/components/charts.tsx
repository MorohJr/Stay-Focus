import { useState, type ReactNode } from 'react';
import { addDays, dayOfWeek, formatDMY, HE_DAYS, HE_MONTHS } from '../../domain/dates';
import { yearFraction, type ProjectSpan } from '../../domain/yearReview';

/**
 * Small charts for the year summary (R-YIR-2). Plain HTML/SVG, one hue (the accent) for magnitude,
 * time runs right → left like the rest of the app (RTL). Tapping a mark shows its exact value.
 */

/** Vertical bars. `ghost` = last year's value, drawn as a thin tick (same axis, no second scale). */
export function Bars({ values, labels, ghost, highlight, unit, describe }: { values: number[]; labels: string[]; ghost?: number[]; highlight?: number; unit: string; describe: (i: number) => string }) {
  const [sel, setSel] = useState<number>();
  const max = Math.max(1, ...values, ...(ghost ?? []));
  const shown = sel ?? highlight;
  return (
    <figure className="chart">
      <div className="bars" role="list">
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            role="listitem"
            className={`bar-col ${i === highlight ? 'hi' : ''} ${i === sel ? 'sel' : ''}`}
            aria-label={`${describe(i)}: ${v} ${unit}`}
            title={`${describe(i)}: ${v} ${unit}`}
            onClick={() => setSel(sel === i ? undefined : i)}
          >
            <span className="bar-area">
              {i === shown && v > 0 && (
                <span className="bar-val num" style={{ bottom: `${(v / max) * 100}%` }}>
                  {v}
                </span>
              )}
              <i style={{ height: `${(v / max) * 100}%` }} />
              {ghost && ghost[i]! > 0 && <b className="ghost" style={{ bottom: `${(ghost[i]! / max) * 100}%` }} />}
            </span>
            <span className="bar-lab">{labels[i]}</span>
          </button>
        ))}
      </div>
      {sel !== undefined && (
        <figcaption className="chart-cap">
          {describe(sel)}: <b className="num">{values[sel]}</b> {unit}
          {ghost && <span className="muted"> · בשנה הקודמת {ghost[sel]}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** Horizontal bars with a label, a value and a share. */
export function HBars({ rows }: { rows: { key: string; label: ReactNode; value: number; pct: number; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hbar">
          <span className="hbar-lab">{r.label}</span>
          <span className="hbar-track">
            <i style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </span>
          <span className="hbar-val num">
            {r.value} <small>{r.pct}%</small>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Every day of the year: weeks as columns (first week on the right), Sunday on top. */
export function Heatmap({ year, daily, today }: { year: number; daily: Record<string, number>; today: string }) {
  const [sel, setSel] = useState<string>();
  const first = addDays(`${year}-01-01`, -dayOfWeek(`${year}-01-01`));
  const last = `${year}-12-31`;
  const cols = Math.ceil((Number(new Date(`${last}T12:00:00`)) - Number(new Date(`${first}T12:00:00`))) / 86400000 / 7) + 1;
  const max = Math.max(1, ...Object.values(daily));
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const cell = 10;
  const gap = 2;
  const W = cols * (cell + gap);
  const cells: ReactNode[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const d = addDays(first, c * 7 + r);
      if (d < `${year}-01-01` || d > last) continue;
      const n = daily[d] ?? 0;
      cells.push(
        <rect
          key={d}
          x={W - (c + 1) * (cell + gap)}
          y={r * (cell + gap)}
          width={cell}
          height={cell}
          rx={2.5}
          className={`h${d > today ? 'f' : level(n)} ${sel === d ? 'sel' : ''}`}
          onClick={() => setSel(sel === d ? undefined : d)}
        >
          <title>{`${formatDMY(d)}: ${n}`}</title>
        </rect>,
      );
    }
  }
  const monthTicks = HE_MONTHS.map((m, i) => {
    const d = `${year}-${String(i + 1).padStart(2, '0')}-01`;
    const c = Math.floor((Number(new Date(`${d}T12:00:00`)) - Number(new Date(`${first}T12:00:00`))) / 86400000 / 7);
    return (
      <text key={m} x={W - c * (cell + gap)} y={7 * (cell + gap) + 10} className="hm-month" textAnchor="end">
        {m.slice(0, 3)}
      </text>
    );
  });
  return (
    <figure className="chart">
      <svg className="heatmap" viewBox={`0 0 ${W} ${7 * (cell + gap) + 14}`} role="img" aria-label={`מפת חום של ${year}`}>
        {cells}
        {monthTicks}
      </svg>
      <figcaption className="chart-cap row">
        {sel ? (
          <span className="grow">
            יום {HE_DAYS[dayOfWeek(sel)]}, {formatDMY(sel)}: <b className="num">{daily[sel] ?? 0}</b> משימות
          </span>
        ) : (
          <span className="grow muted">לחיצה על יום מראה כמה משימות הושלמו בו</span>
        )}
        <span className="hm-legend">
          פחות
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`h${l}`} />
          ))}
          יותר
        </span>
      </figcaption>
    </figure>
  );
}

/** Projects along the year: January on the right. Full bar = finished this year. */
export function Gantt({ spans, year, today, onOpen, icon }: { spans: ProjectSpan[]; year: number; today: string; onOpen: (id: string) => void; icon: (s: ProjectSpan) => ReactNode }) {
  const nowPos = today.startsWith(String(year)) ? yearFraction(today, year) : undefined;
  return (
    <div className="gantt">
      <div className="gantt-axis">
        {HE_MONTHS.map((m) => (
          <span key={m}>{m.slice(0, 1)}</span>
        ))}
      </div>
      {spans.map((s) => {
        const a = yearFraction(s.start, year);
        const b = yearFraction(s.end, year) + 1 / 365;
        return (
          <button key={s.id} type="button" className="gantt-row" onClick={() => onOpen(s.id)} title={`${s.name}: ${formatDMY(s.start)} עד ${formatDMY(s.end)}`}>
            <span className="gantt-name">
              {icon(s)}
              <span className="ellipsis">{s.name}</span>
              <small className="muted num">{s.done ? `הושלם ${formatDMY(s.end)}` : 'פתוח'}{s.tasksDone ? ` · ${s.tasksDone} משימות` : ''}</small>
            </span>
            <span className="gantt-track">
              {nowPos !== undefined && <b className="gantt-now" style={{ insetInlineStart: `${nowPos * 100}%` }} />}
              <i className={s.done ? 'done' : ''} style={{ insetInlineStart: `${a * 100}%`, width: `${Math.max(1.2, (b - a) * 100)}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** R-YIR-5 (glass look): completed tasks per month, stacked by area. Tap a month for its numbers. */
export function StackedBars({ months, series, labels, describe }: { months: number[][]; series: { key: string; name: string; color: string }[]; labels: string[]; describe: (i: number) => string }) {
  const [sel, setSel] = useState<number>();
  const max = Math.max(1, ...months.map((m) => m.reduce((a, b) => a + b, 0)));
  return (
    <figure className="chart">
      <div className="sbars" role="list">
        {months.map((m, i) => {
          const sum = m.reduce((a, b) => a + b, 0);
          return (
            <button key={i} type="button" role="listitem" className={`sbar ${i === sel ? 'sel' : ''}`} aria-label={`${describe(i)}: ${sum}`} onClick={() => setSel(sel === i ? undefined : i)} style={{ ['--i' as string]: i }}>
              <span className="sbar-area">
                <span className="sbar-stack" style={{ height: `${(sum / max) * 100}%` }}>
                  {m.map((v, k) => (v > 0 ? <i key={k} style={{ flexGrow: v, background: series[k]!.color }} /> : null))}
                </span>
              </span>
              <span className="bar-lab">{labels[i]}</span>
            </button>
          );
        })}
      </div>
      {sel !== undefined && (
        <figcaption className="chart-cap">
          {describe(sel)}:{' '}
          {series
            .map((s, k) => ({ s, v: months[sel]![k]! }))
            .filter((x) => x.v > 0)
            .map((x) => `${x.s.name} ${x.v}`)
            .join(' · ') || 'אין'}
        </figcaption>
      )}
    </figure>
  );
}

/** R-YIR-5 (glass look): shares as a ring that draws itself, the total in the middle. */
export function Donut({ rows, total, unit, center }: { rows: { key: string; label: ReactNode; value: number; pct: number; color: string }[]; total: number; unit: string; center: ReactNode }) {
  const r = 58;
  const C = 2 * Math.PI * r;
  const gap = rows.length > 1 ? 4 : 0;
  const arc = (v: number) => (C * v) / Math.max(1, total);
  const starts = rows.map((_, i) => rows.slice(0, i).reduce((sum, x) => sum + arc(x.value), 0));
  return (
    <div className="donut">
      <div className="dw">
        <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
          <circle cx="74" cy="74" r={r} fill="none" stroke="var(--track)" strokeWidth="16" />
          {rows.map((x, i) => {
            const len = Math.max(0, arc(x.value) - gap);
            const off = -starts[i]!;
            return <circle key={x.key} className="dseg" cx="74" cy="74" r={r} fill="none" stroke={x.color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${len} ${C}`} strokeDashoffset={off} style={{ ['--i' as string]: i, ['--len' as string]: len }} />;
          })}
        </svg>
        <div className="c">
          <b className="num">{center}</b>
          <small>{unit}</small>
        </div>
      </div>
      <div className="dleg">
        {rows.map((x) => (
          <div key={x.key}>
            <i style={{ background: x.color }} />
            <span className="grow ellipsis">{x.label}</span>
            <b className="num">{x.pct}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}
