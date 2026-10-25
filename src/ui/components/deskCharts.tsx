import { useId, useState, type ReactNode } from 'react';
import { formatDMY, HE_DAYS, dayOfWeek } from '../../domain/dates';
import type { DayMark } from '../../domain/challenge';
import { niceTicks } from '../../domain/trend';

/**
 * R-DSK-4 (glass look, desktop only): five charts, each its own shape: a smooth line with an area, lollipops, a step line,
 * mirror bars, a heat matrix and streak lanes. Time runs right → left (RTL). Hover or keyboard focus shows the values.
 */

const dm = (d: string) => formatDMY(d).slice(0, 5);
/** Hover card beside the hovered column (index i of n), never on it. */
const tipSide = (i: number, n: number) =>
  (i + 0.5) / n < 0.6 ? { insetInlineStart: `calc(${((i + 1) / n) * 100}% + 8px)` } : { insetInlineEnd: `calc(${((n - i) / n) * 100}% + 8px)` };

/** The top of a chart card: a title, a big number with its words, and an optional comparison chip. */
export function ChartHead({ title, value, unit, change, note, children }: { title: string; value: ReactNode; unit: string; change?: number | null; note?: string; children?: ReactNode }) {
  return (
    <div className="dc-head">
      <div>
        <div className="dc-title">{title}</div>
        <div className="tc-big">
          <span className="num">{value}</span>
          <small>{unit}</small>
        </div>
        {(change !== undefined && change !== null) || note ? (
          <div className="tc-cmp">
            {change !== undefined && change !== null && (
              <span className={`tag ${change >= 0 ? 'ok' : 'red'}`}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
              </span>
            )}
            {note && <span className="muted">{note}</span>}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Hits({ n, titles, onHover }: { n: number; titles: string[]; onHover: (i: number | undefined) => void }) {
  return (
    <div className="dc-hits" role="list">
      {Array.from({ length: n }, (_, i) => (
        <button key={i} type="button" role="listitem" aria-label={titles[i]} onMouseEnter={() => onHover(i)} onFocus={() => onHover(i)} onBlur={() => onHover(undefined)} onClick={() => onHover(i)} />
      ))}
    </div>
  );
}

function YAxis({ ticks, top, fmt = String }: { ticks: number[]; top: number; fmt?: (v: number) => string }) {
  return (
    <div className="rc-y" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} className="num" style={{ bottom: `${(t / top) * 100}%` }}>
          {fmt(t)}
        </span>
      ))}
    </div>
  );
}

function Grid({ ticks, top }: { ticks: number[]; top: number }) {
  return (
    <>
      {ticks.map((t) => (
        <i key={t} className="rc-grid" style={{ bottom: `${(t / top) * 100}%` }} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Line (smooth with an area, or steps), on an SVG stretched to the box
// ---------------------------------------------------------------------------

export interface LineSeries {
  name: string;
  values: (number | undefined)[];
  color: string;
  dashed?: boolean;
  area?: boolean;
  step?: boolean;
}

const W = 1000;
const H = 300;

function pathOf(vals: (number | undefined)[], top: number, mode: 'smooth' | 'step' | 'straight'): string[] {
  const n = vals.length;
  const x = (i: number) => W * (1 - (i + 0.5) / n);
  const y = (v: number) => H - (v / top) * H;
  const parts: string[] = [];
  let cur = '';
  let prev: [number, number] | undefined;
  vals.forEach((v, i) => {
    if (v === undefined) {
      if (cur) parts.push(cur);
      cur = '';
      prev = undefined;
      return;
    }
    const p: [number, number] = [x(i), y(v)];
    if (!prev) cur = `M${p[0]},${p[1]}`;
    else if (mode === 'step') cur += ` H${p[0]} V${p[1]}`;
    else if (mode === 'straight') cur += ` L${p[0]},${p[1]}`;
    else {
      const mx = (prev[0] + p[0]) / 2;
      cur += ` C${mx},${prev[1]} ${mx},${p[1]} ${p[0]},${p[1]}`;
    }
    prev = p;
  });
  if (cur) parts.push(cur);
  return parts;
}

export function LinePlot({ series, labels, titles, unit, labelEvery = 1, height = 280 }: { series: LineSeries[]; labels: string[]; titles: string[]; unit: string; labelEvery?: number; height?: number }) {
  const [hov, setHov] = useState<number>();
  const gid = useId();
  const n = labels.length;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== undefined))));
  const top = ticks[ticks.length - 1]!;
  return (
    <figure className="rchart" onMouseLeave={() => setHov(undefined)}>
      <div className="rc-plot">
        <YAxis ticks={ticks} top={top} />
        <div className="rc-area" style={{ height }}>
          <Grid ticks={ticks} top={top} />
          <svg className="lp-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              {series.map((s, k) => (
                <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {series.map((s, k) =>
              pathOf(s.values, top, s.step ? 'step' : s.dashed ? 'straight' : 'smooth').map((d, j) => (
                <g key={`${k}-${j}`}>
                  {s.area && <path className="lp-area" d={`${d} V${H} H${d.match(/^M([\d.]+)/)![1]} Z`} fill={`url(#${gid}-${k})`} />}
                  <path className={`lp-line${s.dashed ? ' dash' : ''}`} d={d} stroke={s.color} vectorEffect="non-scaling-stroke" />
                </g>
              )),
            )}
          </svg>
          {series.map((s) => {
            // where the line ends now (today), even when it is a single day
            const last = s.dashed ? -1 : s.values.findLastIndex((v) => v !== undefined);
            return last < 0 || last === hov ? null : <i key={s.name} className="lp-dot end" style={{ insetInlineStart: `${((last + 0.5) / n) * 100}%`, bottom: `${(s.values[last]! / top) * 100}%`, borderColor: s.color }} />;
          })}
          {hov !== undefined && (
            <>
              <i className="lp-guide" style={{ insetInlineStart: `${((hov + 0.5) / n) * 100}%` }} />
              {series.map((s) =>
                s.values[hov] === undefined ? null : <i key={s.name} className="lp-dot" style={{ insetInlineStart: `${((hov + 0.5) / n) * 100}%`, bottom: `${(s.values[hov]! / top) * 100}%`, borderColor: s.color }} />,
              )}
              <div className="rc-tip" role="status" style={tipSide(hov, n)}>
                <b>{titles[hov]}</b>
                {series.map((s) => (
                  <div key={s.name} className="rc-tip-r">
                    <i style={{ background: s.color }} />
                    <span className="grow">{s.name}</span>
                    <b className="num">{s.values[hov] ?? '—'}</b>
                  </div>
                ))}
                <div className="rc-tip-p">{unit}</div>
              </div>
            </>
          )}
          <Hits n={n} titles={titles} onHover={setHov} />
        </div>
      </div>
      <div className="rc-x" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={i} className={i === hov ? 'on' : ''}>
            {i % labelEvery === labelEvery - 1 || i === hov ? l : ''}
          </span>
        ))}
      </div>
      <Legend items={series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed }))} />
    </figure>
  );
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean; bar?: boolean }[] }) {
  return (
    <div className="tc-leg">
      {items.map((x) => (
        <span key={x.name}>
          <b className={`dc-key${x.dashed ? ' dash' : ''}${x.bar ? ' bar' : ''}`} style={{ ['--c' as string]: x.color }} />
          {x.name}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lollipops: one stick and a dot per sprint, 0–100%, with the average line
// ---------------------------------------------------------------------------

export function Lollipops({ rows, avg }: { rows: { label: string; title: string; pct: number; sub: string; hi?: boolean }[]; avg: number | null }) {
  const [hov, setHov] = useState<number>();
  const n = rows.length;
  const ticks = [0, 25, 50, 75, 100];
  return (
    <figure className="rchart" onMouseLeave={() => setHov(undefined)}>
      <div className="rc-plot">
        <YAxis ticks={ticks} top={100} fmt={(v) => `${v}%`} />
        <div className="rc-area lol" style={{ height: 260 }}>
          <Grid ticks={ticks} top={100} />
          {avg !== null && (
            <i className="lol-avg" style={{ bottom: `${avg}%` }}>
              <span>ממוצע {avg}%</span>
            </i>
          )}
          <div className="lol-cols">
            {rows.map((r, i) => (
              <span key={i} className={`lol-col${r.hi ? ' hi' : ''}${i === hov ? ' on' : ''}`} style={{ ['--i' as string]: i }}>
                <i className="lol-stick" style={{ height: `${r.pct}%` }} />
                <b className="lol-dot num" style={{ bottom: `${r.pct}%` }}>
                  {r.pct}
                </b>
              </span>
            ))}
          </div>
          {hov !== undefined && (
            <div className="rc-tip" role="status" style={tipSide(hov, n)}>
              <b>{rows[hov]!.title}</b>
              <div className="rc-tip-v">
                <span className="num">{rows[hov]!.pct}%</span> הושלמו
              </div>
              <div className="rc-tip-p">{rows[hov]!.sub}</div>
            </div>
          )}
          <Hits n={n} titles={rows.map((r) => `${r.title}: ${r.pct}%`)} onHover={setHov} />
        </div>
      </div>
      <div className="rc-x" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={i} className={i === hov ? 'on' : ''}>
            {r.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Mirror bars: added above the middle, done below, and a line of what was still open
// ---------------------------------------------------------------------------

export function MirrorBars({ rows }: { rows: { label: string; title: string; added: number; done: number; open: number }[] }) {
  const [hov, setHov] = useState<number>();
  const n = rows.length;
  const ticks = niceTicks(Math.max(0, ...rows.flatMap((r) => [r.added, r.done])), 3);
  const top = ticks[ticks.length - 1]!;
  const openMax = Math.max(1, ...rows.map((r) => r.open));
  const half = (v: number) => `${(v / top) * 50}%`;
  const pts = rows.map((r, i) => `${W * (1 - (i + 0.5) / n)},${H - (r.open / openMax) * H * 0.92}`).join(' ');
  return (
    <figure className="rchart" onMouseLeave={() => setHov(undefined)}>
      <div className="rc-plot">
        <div className="rc-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={`u${t}`} className="num" style={{ bottom: `${50 + (t / top) * 50}%` }}>
              {t}
            </span>
          ))}
          {ticks.slice(1).map((t) => (
            <span key={`d${t}`} className="num" style={{ bottom: `${50 - (t / top) * 50}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="rc-area" style={{ height: 300 }}>
          {ticks.map((t) => (
            <i key={`u${t}`} className="rc-grid" style={{ bottom: `${50 + (t / top) * 50}%` }} />
          ))}
          {ticks.slice(1).map((t) => (
            <i key={`d${t}`} className="rc-grid" style={{ bottom: `${50 - (t / top) * 50}%` }} />
          ))}
          <i className="mb-axis" />
          <div className="mb-cols">
            {rows.map((r, i) => (
              <span key={i} className={`mb-col${i === hov ? ' on' : ''}`} style={{ ['--i' as string]: i }}>
                <i className="mb-up" style={{ height: half(r.added) }} />
                <i className="mb-down" style={{ height: half(r.done) }} />
              </span>
            ))}
          </div>
          <svg className="lp-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline className="lp-line mb-open" points={pts} vectorEffect="non-scaling-stroke" />
          </svg>
          {n > 0 && (
            <span className="mb-open-lab" style={{ insetInlineStart: `${((n - 0.5) / n) * 100}%`, bottom: `${(rows[n - 1]!.open / openMax) * 92}%` }}>
              <b className="num">{rows[n - 1]!.open}</b> פתוחות
            </span>
          )}
          {hov !== undefined && (
            <div className="rc-tip" role="status" style={tipSide(hov, n)}>
              <b>{rows[hov]!.title}</b>
              <div className="rc-tip-r">
                <i style={{ background: 'var(--sand2)' }} />
                <span className="grow">נוספו</span>
                <b className="num">{rows[hov]!.added}</b>
              </div>
              <div className="rc-tip-r">
                <i style={{ background: 'var(--blue)' }} />
                <span className="grow">הושלמו</span>
                <b className="num">{rows[hov]!.done}</b>
              </div>
              <div className="rc-tip-p">
                פתוחות בסוף השבוע: <b className="num">{rows[hov]!.open}</b>
              </div>
            </div>
          )}
          <Hits n={n} titles={rows.map((r) => `${r.title}: נוספו ${r.added}, הושלמו ${r.done}`)} onHover={setHov} />
        </div>
      </div>
      <div className="rc-x" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={i} className={i === hov ? 'on' : ''}>
            {r.label}
          </span>
        ))}
      </div>
      <Legend
        items={[
          { name: 'נוספו (למעלה)', color: 'var(--sand2)', bar: true },
          { name: 'הושלמו (למטה)', color: 'var(--blue)', bar: true },
          { name: 'פתוחות בסוף השבוע', color: 'var(--ink)' },
        ]}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Heat matrix: a row per routine item, a square per day, the day's share below
// ---------------------------------------------------------------------------

export function HeatMatrix({ dates, rows, pct }: { dates: string[]; rows: { id: string; title: string; cells: (boolean | null)[] }[]; pct: (number | null)[] }) {
  const [hov, setHov] = useState<number>();
  const cols = { gridTemplateColumns: `minmax(120px, 190px) repeat(${dates.length}, minmax(0, 1fr))` };
  return (
    <figure className="hm2" onMouseLeave={() => setHov(undefined)}>
      <div className="hm2-grid" style={cols}>
        <span />
        {dates.map((d, k) => (
          <span key={d} className={`hm2-d${k === hov ? ' on' : ''}`}>
            {k % 5 === 4 || k === hov ? Number(d.slice(8, 10)) : ''}
          </span>
        ))}
        {rows.map((r) => [
          <span key={r.id} className="hm2-name ellipsis">
            {r.title}
          </span>,
          ...r.cells.map((c, k) => <i key={`${r.id}${k}`} className={`hm2-c ${c === null ? 'na' : c ? 'y' : 'n'}${k === hov ? ' on' : ''}`} style={{ ['--i' as string]: k }} />),
        ])}
        <span className="hm2-name muted">אחוז היום</span>
        {pct.map((p, k) => (
          <button key={k} type="button" className={`hm2-p${k === hov ? ' on' : ''}`} aria-label={`${formatDMY(dates[k]!)}: ${p ?? 0}%`} onMouseEnter={() => setHov(k)} onFocus={() => setHov(k)} onClick={() => setHov(k)}>
            <i style={{ height: `${p ?? 0}%` }} />
          </button>
        ))}
      </div>
      <figcaption className="chart-cap">
        {hov === undefined ? (
          <span className="muted">ריחוף על יום מראה מה סומן בו</span>
        ) : (
          <>
            יום {HE_DAYS[dayOfWeek(dates[hov]!)]}, {dm(dates[hov]!)}: <b className="num">{pct[hov] ?? 0}%</b>
            {' · '}
            {rows.filter((r) => r.cells[hov]).map((r) => r.title).join(', ') || 'לא סומן כלום'}
          </>
        )}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Streak lanes: a lane per challenge, clean runs as bars, broken days as dots
// ---------------------------------------------------------------------------

export function StreakLanes({ dates, lanes }: { dates: string[]; lanes: { id: string; name: string; marks: (DayMark | null)[]; runs: { start: number; end: number }[]; longest: number; current: number }[] }) {
  const [sel, setSel] = useState<string>();
  const n = dates.length;
  const at = (i: number) => `${(i / n) * 100}%`;
  return (
    <figure className="lanes">
      {lanes.map((l) => {
        const first = l.marks.findIndex((m) => m !== null);
        const last = l.marks.length - 1 - [...l.marks].reverse().findIndex((m) => m !== null);
        return (
          <div key={l.id} className="lane">
            <span className="lane-name ellipsis">{l.name}</span>
            <span className="lane-track">
              <i className="lane-span" style={{ insetInlineStart: at(first), width: at(last - first + 1) }} />
              {l.runs.map((r) => {
                const key = `${l.id}${r.start}`;
                const len = r.end - r.start + 1;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`lane-run${sel === key ? ' on' : ''}`}
                    style={{ insetInlineStart: at(r.start), width: at(len), ['--i' as string]: r.start }}
                    aria-label={`${len} ימים נקיים, ${dm(dates[r.start]!)}–${dm(dates[r.end]!)}`}
                    onMouseEnter={() => setSel(key)}
                    onFocus={() => setSel(key)}
                    onMouseLeave={() => setSel(undefined)}
                    onBlur={() => setSel(undefined)}
                  >
                    {sel === key && (
                      <span className="lane-tip">
                        {len} ימים נקיים · {dm(dates[r.start]!)}–{dm(dates[r.end]!)}
                      </span>
                    )}
                  </button>
                );
              })}
              {l.marks.map((m, i) => (m === 'broken' || m === 'partial' ? <i key={i} className={`lane-dot ${m}`} style={{ insetInlineStart: `calc(${at(i)} + ${50 / n}%)` }} title={`${dm(dates[i]!)}: ${m === 'broken' ? 'נשבר' : 'חלקי'}`} /> : null))}
            </span>
            <span className="lane-stat">
              <b className="num">{l.current}</b> עכשיו
              <small className="muted">
                {' · '}שיא <span className="num">{l.longest}</span>
              </small>
            </span>
          </div>
        );
      })}
      <div className="lane lane-axis" aria-hidden="true">
        <span />
        <span className="lane-track">
          {dates.map((d, i) =>
            i % 10 === 0 || i === n - 1 ? (
              <span key={d} style={{ insetInlineStart: `calc(${at(i)} + ${50 / n}%)` }}>
                {i === n - 1 ? 'היום' : dm(d)}
              </span>
            ) : null,
          )}
        </span>
        <span />
      </div>
      <Legend
        items={[
          { name: 'רצף נקי', color: 'var(--blue)', bar: true },
          { name: 'יום שנשבר', color: 'var(--danger)', bar: true },
        ]}
      />
    </figure>
  );
}
