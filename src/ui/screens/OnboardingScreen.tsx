import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HE_DAYS_SHORT, formatDMY } from '../../domain/dates';
import { canLeaveStep, ONBOARDING_STEPS, type TaskDestination } from '../../domain/onboarding';
import { describeRule } from '../../domain/recurring';
import type { NoteKind, RecurrenceRule, RoutineKind, RoutineSettings } from '../../domain/schemas';
import { sprintStatus } from '../../domain/sprints';
import { isOpen } from '../../domain/tasks';
import { getSettings, updateSettings } from '../../services/entity';
import { addRoutineItem, deleteChallenge, deleteRecurring, deleteRoutineItem, saveRecurring } from '../../services/habits';
import { deleteArea, saveArea } from '../../services/misc';
import { addOnboardingTask, finishOnboarding, startChallenge } from '../../services/onboarding';
import { addAgenda, addMilestone, createPerson, deleteMilestone, deletePerson, setWeeklyGoals, updatePerson } from '../../services/people';
import { createGoal, createNote, createProject, deleteGoal, deleteNote, deleteProject, noteTitle, setFocusGoal } from '../../services/planning';
import { currentPosition } from '../../services/platform';
import { Q } from '../../services/queries';
import { addToSprint, deleteTask } from '../../services/tasks';
import { refreshWeather, searchPlaces, type Place } from '../../services/weather';
import { Seg, TopBar } from '../components/common';
import { DayMonthPicker } from '../components/edit';
import { Icon } from '../components/Icon';
import { useClock, useLive } from '../hooks';
import { replace } from '../router';
import { AREA_COLORS } from './MoreScreens';
import { NOTE_KIND_LABEL } from './NotesScreens';
import { PERSON_EMOJIS } from './PeopleScreens';
import { PROJECT_ICONS } from './ProjectsScreen';

/**
 * SPEC 5.13 (R-ONB): the intro on first run and after "delete all data".
 * Rotating slides, then one step per kind of data. Everything added is saved right away in the regular tables.
 */
export function OnboardingScreen() {
  const { today } = useClock();
  const settings = useLive(Q.settings);
  const [step, setStep] = useState(-1); // -1 = slides
  const [name, setName] = useState<string | null>(null);
  if (!settings) return null;
  const nameNow = name ?? settings.userName;

  const finish = async () => {
    if (nameNow.trim()) await updateSettings({ userName: nameNow.trim() });
    await finishOnboarding(today);
    replace('/');
  };
  const goTo = async (n: number) => {
    if (step === 0 && nameNow.trim()) await updateSettings({ userName: nameNow.trim() });
    setStep(n);
    window.scrollTo(0, 0);
  };

  if (step < 0) return <Slides onStart={() => void goTo(0)} onSkip={() => void finish()} />;

  const s = ONBOARDING_STEPS[step]!;
  const last = step === ONBOARDING_STEPS.length - 1;
  const ok = canLeaveStep(s.id, nameNow);
  return (
    <div className="page sub onb-steps">
      <TopBar title={s.title} sub={STEP_SUB[s.id]} stats={[{ v: <span className="ltr">{step + 1}/{ONBOARDING_STEPS.length}</span>, k: 'צעד' }]}>
        {!last && (
          <button type="button" className="minibtn" onClick={() => void finish()}>
            דלג על הכול
          </button>
        )}
      </TopBar>
      <div className="onb-progress" aria-hidden="true">
        {ONBOARDING_STEPS.map((x, i) => (
          <i key={x.id} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {s.id === 'details' && <StepDetails name={nameNow} setName={setName} />}
      {s.id === 'how' && <StepHow />}
      {s.id === 'areas' && <StepAreas />}
      {s.id === 'goals' && <StepGoals />}
      {s.id === 'projects' && <StepProjects />}
      {s.id === 'tasks' && <StepTasks today={today} />}
      {s.id === 'sprint' && <StepSprint today={today} />}
      {s.id === 'recurring' && <StepRecurring today={today} />}
      {s.id === 'routines' && <StepRoutines />}
      {s.id === 'challenge' && <StepChallenge today={today} />}
      {s.id === 'people' && <StepPeople />}
      {s.id === 'notes' && <StepNotes />}
      {s.id === 'done' && <StepDone name={nameNow} />}

      <div className="onb-foot">
        <button type="button" className="btn" onClick={() => void goTo(step - 1)}>
          חזרה
        </button>
        {!last && s.id !== 'details' && s.id !== 'how' && (
          <button type="button" className="btn ghost" onClick={() => void goTo(step + 1)}>
            דלג
          </button>
        )}
        {last ? (
          <button type="button" className="btn blue grow" onClick={() => void finish()}>
            יאללה, מתחילים 🎉
          </button>
        ) : (
          <button type="button" className="btn primary grow" disabled={!ok} onClick={() => void goTo(step + 1)}>
            הבא
          </button>
        )}
      </div>
    </div>
  );
}

const STEP_SUB: Record<(typeof ONBOARDING_STEPS)[number]['id'], string> = {
  details: 'רק מה שצריך כדי להתחיל',
  how: 'דקה אחת, ואז ממלאים',
  areas: 'החלקים הגדולים של החיים שלך',
  goals: 'לאן אתה רוצה להגיע',
  projects: 'מה בונים בדרך למטרות',
  tasks: 'כל מה שבראש, החוצה',
  sprint: 'שבוע אחד, ראשון עד שבת',
  recurring: 'מה שחוזר על עצמו',
  routines: 'הבוקר והערב שלך',
  challenge: 'חוקים לתקופה מסוימת',
  people: 'עם מי ועל מה לדבר',
  notes: 'רעיונות, פגישות ומחשבות',
  done: 'הכול מוכן',
};

// ---------------------------------------------------------------------------
// R-ONB-2: rotating slides
// ---------------------------------------------------------------------------

interface Slide {
  icon: string;
  title: string;
  text: string;
  demo: ReactNode;
}

const SLIDES: Slide[] = [
  {
    icon: 'today',
    title: 'היום',
    text: 'מסך אחד שבונה את עצמו מהנתונים שלך: מה עכשיו, מה הבא, 3 החשובים, מה באיחור והשגרה של השעה הזאת. אין מה לסדר בו, רק לעשות.',
    demo: (
      <>
        <div className="onb-mini-hero">
          <span className="k">עכשיו · 09:30–10:30</span>
          <b>לכתוב את ההצעה ללקוח</b>
          <i>
            <i style={{ width: '40%' }} />
          </i>
        </div>
        <div className="onb-mini-h">3 החשובים היום</div>
        <MiniRow done>לשלוח חשבונית</MiniRow>
        <MiniRow>להתקשר לרופא</MiniRow>
        <MiniRow>לסגור את הגרסה</MiniRow>
      </>
    ),
  },
  {
    icon: 'inbox',
    title: 'משימות ודואר נכנס',
    text: 'כל מחשבה נרשמת בשנייה עם כפתור +, ונוחתת בדואר הנכנס. אחר כך נותנים לה תאריך, פרויקט או שבוע, והיא יוצאת משם. יש גם יומן, מטריצה, "ממתין ל..." ו"אולי פעם".',
    demo: (
      <>
        <div className="onb-mini-h">דואר נכנס · 3</div>
        {['להזמין שולחן לשישי', 'רעיון לפוסט', 'לבדוק ביטוח רכב'].map((t) => (
          <div key={t} className="onb-mini-row">
            <span className="sdot" />
            <span className="grow">{t}</span>
            <Icon name="cal" size="xs" />
            <Icon name="folder" size="xs" />
            <Icon name="sprint" size="xs" />
          </div>
        ))}
      </>
    ),
  },
  {
    icon: 'sprint',
    title: 'ספרינט שבועי',
    text: 'כל שבוע הוא ספרינט, ראשון עד שבת, שנוצר לבד. מושכים אליו משימות, עובדים על לוח, ובסוף השבוע סקירה מודרכת שמסדרת את מה שנשאר.',
    demo: (
      <div className="onb-mini-cols">
        {[
          ['לעשות', ['דף נחיתה', 'מצגת']],
          ['בתהליך', ['עיצוב לוגו']],
          ['בוצע', ['מחקר', 'תקציר']],
        ].map(([h, list]) => (
          <div key={h as string}>
            <b>{h}</b>
            {(list as string[]).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: 'mountain',
    title: 'פרויקטים ומטרות',
    text: 'מטרה גדולה מתפרקת לפרויקטים, ופרויקט למשימות ואבני דרך. ההתקדמות מחושבת לבד, ומטרה אחת תמיד בפוקוס במסך היום.',
    demo: (
      <>
        <div className="onb-mini-h">מטרה בפוקוס</div>
        <b style={{ display: 'block', fontSize: 15, marginBottom: 6 }}>להשיק מוצר משלי</b>
        <div className="bar">
          <i style={{ width: '62%' }} />
        </div>
        {[
          ['🌐', 'אתר', 80],
          ['🧩', 'גרסה ראשונה', 45],
        ].map(([ic, n, p]) => (
          <div key={n as string} className="onb-mini-row">
            <span>{ic}</span>
            <span className="grow">{n}</span>
            <span className="minibar">
              <i style={{ width: `${p}%` }} />
            </span>
            <b className="num">{p}%</b>
          </div>
        ))}
      </>
    ),
  },
  {
    icon: 'sunrise',
    title: 'שגרות ומשימות חוזרות',
    text: 'שגרת בוקר וערב מופיעות בשעות שלהן ונעלמות כשנגמרות. משימה חוזרת (כל יום, כל ראשון, פעם בחודש) נוצרת לבד ביום שלה.',
    demo: (
      <>
        <div className="onb-mini-h">שגרת בוקר · 2/4</div>
        <div className="chips">
          <span className="chip ok">כוס מים ✓</span>
          <span className="chip ok">מיטה ✓</span>
          <span className="chip">קריאה</span>
          <span className="chip">תכנון היום</span>
        </div>
        <div className="rbar">
          <i style={{ width: '50%' }} />
        </div>
        <div className="onb-mini-row" style={{ marginTop: 8 }}>
          <Icon name="repeat" size="xs" />
          <span className="grow">לתת כביסה</span>
          <span className="muted">כל ראשון</span>
        </div>
      </>
    ),
  },
  {
    icon: 'shield',
    title: 'אתגרים',
    text: 'תקופה עם חוקים, למשל 30 יום בלי סוכר. כל יום מסמנים "שמרתי" או "לא", ורואים את הרצף ואת היסטוריית הימים.',
    demo: (
      <>
        <div className="onb-mini-h">יום 12 מתוך 30 · רצף 11 🔥</div>
        <div className="rulegrid">
          <span className="rule kept">✓ בלי סוכר</span>
          <span className="rule kept">✓ לישון עד 23:00</span>
          <span className="rule">10 דק׳ קריאה</span>
          <span className="rule broken">✕ בלי טלפון במיטה</span>
        </div>
      </>
    ),
  },
  {
    icon: 'users',
    title: 'פתקים ואנשים',
    text: 'פתקים, רעיונות וסיכומי פגישות עם תבניות מוכנות. לכל אדם: על מה לדבר איתו בפעם הבאה, מה ממתין לו, ומתי יום ההולדת.',
    demo: (
      <>
        <div className="onb-mini-row">
          <Icon name="note" size="xs" />
          <span className="grow">סיכום פגישה עם דנה</span>
          <span className="muted">פגישה</span>
        </div>
        <div className="onb-mini-row">
          <Icon name="note" size="xs" />
          <span className="grow">רעיונות לחופשה</span>
          <span className="muted">רעיון</span>
        </div>
        <div className="onb-mini-row">
          <span>👵</span>
          <span className="grow">סבתא · 2 נושאים</span>
          <span className="muted">🎂 בעוד 5 ימים</span>
        </div>
      </>
    ),
  },
  {
    icon: 'lock',
    title: 'רק שלך',
    text: 'בלי שרת ובלי חשבון: הכול נשמר רק במכשיר ועובד גם בלי אינטרנט. מעבר בין טלפון למחשב נעשה בקובץ גיבוי.',
    demo: (
      <div className="onb-mini-list">
        <span>
          <Icon name="lock" size="sm" /> בלי חשבון, בלי שרת
        </span>
        <span>
          <Icon name="bolt" size="sm" /> עובד גם בלי אינטרנט
        </span>
        <span>
          <Icon name="download" size="sm" /> גיבוי לקובץ, שחזור בכל מכשיר
        </span>
      </div>
    ),
  },
];

function MiniRow({ done, children }: { done?: boolean; children: ReactNode }) {
  return (
    <div className={`onb-mini-row ${done ? 'done' : ''}`}>
      <span className={`sdot ${done ? 'done' : ''}`}>{done && <Icon name="check" size="xs" />}</span>
      <span className="grow">{children}</span>
    </div>
  );
}

function Slides({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const startX = useRef<number | null>(null);
  // R-ONB-2: change every 6 seconds until the user touches.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((x) => (x + 1) % SLIDES.length), 6000);
    return () => clearTimeout(t);
  }, [i, paused]);
  const s = SLIDES[i]!;
  const to = (n: number) => {
    setPaused(true);
    setI((n + SLIDES.length) % SLIDES.length);
  };
  return (
    <div
      className="onb"
      onPointerDown={(e) => {
        startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        // RTL: the next slide comes from the left, so a swipe to the right moves forward.
        if (Math.abs(dx) > 40) to(i + (dx > 0 ? 1 : -1));
      }}
    >
      <div className="onb-top">
        <span className="onb-brand">Stay Focus</span>
        <button type="button" className="onb-skip" onClick={onSkip}>
          דלג על הכול
        </button>
      </div>
      <div key={i} className="onb-slide">
        <span className="onb-ic">
          <Icon name={s.icon} />
        </span>
        <h1>{s.title}</h1>
        <p>{s.text}</p>
        <div className="onb-demo" aria-hidden="true">
          {s.demo}
        </div>
      </div>
      <div className="onb-dots" role="tablist" aria-label="חלוניות">
        {SLIDES.map((x, j) => (
          <button key={x.title} type="button" role="tab" aria-selected={j === i} aria-label={x.title} className={j === i ? 'on' : ''} onClick={() => to(j)} />
        ))}
      </div>
      <div className="onb-actions">
        <button type="button" className="btn blue block" onClick={onStart}>
          בוא נתחיל
        </button>
        <button type="button" className="onb-next" onClick={() => to(i + 1)}>
          {i < SLIDES.length - 1 ? 'החלונית הבאה' : 'מההתחלה'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks for the steps
// ---------------------------------------------------------------------------

function Added({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <>
      <div className="section-title">
        <span>{title}</span>
        <span className="num">{count}</span>
      </div>
      <section className="card">{children}</section>
    </>
  );
}

function AddedRow({ lead, title, meta, onDelete, children }: { lead?: ReactNode; title: ReactNode; meta?: ReactNode; onDelete?: () => void; children?: ReactNode }) {
  return (
    <div className="onb-row">
      <div className="onb-row-main">
        {lead && <span className="lead">{lead}</span>}
        <span className="tt">{title}</span>
        {meta && <span className="m">{meta}</span>}
        {onDelete && (
          <button type="button" className="muted" aria-label="מחק" onClick={onDelete}>
            <Icon name="x" size="xs" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="muted small onb-hint">{children}</p>;
}

// ---------------------------------------------------------------------------
// 1. Details
// ---------------------------------------------------------------------------

function StepDetails({ name, setName }: { name: string; setName: (v: string) => void }) {
  return (
    <>
      <section className="card boxed">
        <label className="onb-label" htmlFor="onb-name">
          איך לקרוא לך?
        </label>
        <input id="onb-name" className="input" autoFocus value={name} placeholder="השם שלך" onChange={(e) => setName(e.target.value)} />
        <Hint>מופיע בברכה במסך היום. אפשר לשנות בהגדרות.</Hint>
      </section>
      <WeatherPicker />
    </>
  );
}

function WeatherPicker() {
  const settings = useLive(Q.settings);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [msg, setMsg] = useState<string>();
  const choose = async (p: Place) => {
    await updateSettings({ weather: { placeName: p.name, lat: p.lat, lon: p.lon }, weatherCache: undefined });
    setResults([]);
    setQ('');
    void refreshWeather(true);
  };
  return (
    <section className="card boxed">
      <span className="onb-label">
        <Icon name="sun" size="sm" /> מזג אוויר במסך היום (לא חובה)
      </span>
      {settings?.weather ? (
        <div className="row">
          <Icon name="location" size="sm" />
          <b className="grow">{settings.weather.placeName}</b>
          <button type="button" className="linkbtn" onClick={() => void updateSettings({ weather: undefined, weatherCache: undefined })}>
            החלף
          </button>
        </div>
      ) : (
        <>
          <form
            className="addrow"
            style={{ marginTop: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setMsg(undefined);
              try {
                const r = await searchPlaces(q);
                setResults(r);
                if (!r.length) setMsg('לא נמצאה עיר בשם הזה.');
              } catch {
                setMsg('אין חיבור לאינטרנט. אפשר להגדיר אחר כך.');
              }
            }}
          >
            <input className="input" placeholder="שם עיר, למשל תל אביב" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn" disabled={!q.trim()}>
              חפש
            </button>
          </form>
          {results.map((p) => (
            <button key={`${p.lat},${p.lon}`} type="button" className="opt" onClick={() => void choose(p)}>
              <Icon name="location" size="sm" /> {p.name}
            </button>
          ))}
          <button
            type="button"
            className="linkbtn"
            style={{ marginTop: 8 }}
            onClick={async () => {
              setMsg(undefined);
              try {
                await choose({ name: 'המיקום שלי', ...(await currentPosition()) });
              } catch {
                setMsg('לא התקבלה הרשאת מיקום.');
              }
            }}
          >
            <Icon name="location" size="sm" /> השתמש במיקום שלי
          </button>
          {msg && <p className="muted small">{msg}</p>}
        </>
      )}
      <Hint>רק קו רוחב ואורך נשלחים לשירות מזג האוויר. שום דבר אחר לא יוצא מהמכשיר.</Hint>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. How it works
// ---------------------------------------------------------------------------

function Flow({ items }: { items: string[] }) {
  return (
    <div className="onb-flow">
      {items.map((x, i) => (
        <span key={x} className="row" style={{ gap: 4 }}>
          {i > 0 && <Icon name="chev" size="xs" />}
          <span className="chip">{x}</span>
        </span>
      ))}
    </div>
  );
}

function StepHow() {
  return (
    <>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="mountain" size="sm" /> מלמעלה למטה: תכנון
          </span>
        </h4>
        <Flow items={['מטרה', 'פרויקט', 'משימה', 'השבוע']} />
        <Hint>מחליטים לאן רוצים להגיע, מפרקים לפרויקטים ולמשימות, ובתחילת כל שבוע מושכים לספרינט את מה שעושים השבוע.</Hint>
      </section>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="inbox" size="sm" /> מלמטה למעלה: לאסוף, לסדר, לעשות
          </span>
        </h4>
        <Flow items={['+', 'דואר נכנס', 'תאריך / פרויקט / שבוע', 'היום']} />
        <Hint>כל דבר שעולה בראש נרשם מיד בכפתור + השחור. מתי שנוח, מסדרים את הדואר הנכנס, וכל משימה מקבלת מקום.</Hint>
      </section>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="today" size="sm" /> מסך היום בונה את עצמו
          </span>
        </h4>
        <Hint>אין מה למלא בו. הוא מחושב מכל השאר: מה מתוזמן עכשיו, 3 החשובים, מה באיחור, השגרה של השעה, האתגר והמטרה בפוקוס. כרטיס בלי תוכן פשוט לא מופיע.</Hint>
      </section>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="sparkle" size="sm" /> עכשיו ממלאים
          </span>
        </h4>
        <Hint>בצעדים הבאים יש מקום לכל סוג: תחומים, מטרות, פרויקטים, משימות, השבוע, חוזרות, שגרות, אתגר, אנשים ופתקים. מה שלא בא לך עכשיו, מדלגים. הכול אפשר להוסיף אחר כך.</Hint>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Areas
// ---------------------------------------------------------------------------

function StepAreas() {
  const areas = useLive(Q.areas) ?? [];
  const [name, setName] = useState('');
  return (
    <>
      <Hint>תחומים מקבצים מטרות ופרויקטים. התחלנו עם ארבעה. אפשר לשנות שם, למחוק או להוסיף.</Hint>
      <section className="card">
        {areas.map((a) => (
          <AddedRow
            key={a.id}
            lead={<i className="onb-dot" style={{ background: a.color }} />}
            title={<AreaName id={a.id} name={a.name} />}
            onDelete={() => void deleteArea(a.id)}
          />
        ))}
        <form
          className="addrow"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void saveArea({ name: name.trim(), color: AREA_COLORS[areas.length % AREA_COLORS.length]! });
            setName('');
          }}
        >
          <input className="input" placeholder="+ תחום חדש, למשל בריאות" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim()}>
            הוסף
          </button>
        </form>
      </section>
    </>
  );
}

function AreaName({ id, name }: { id: string; name: string }) {
  const [v, setV] = useState(name);
  return <input className="input bare" aria-label="שם התחום" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== name && void saveArea({ id, name: v.trim() })} />;
}

// ---------------------------------------------------------------------------
// 4. Goals
// ---------------------------------------------------------------------------

function AreaSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const areas = useLive(Q.areas) ?? [];
  return (
    <select id={id} className="mini-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">בלי תחום</option>
      {areas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

function StepGoals() {
  const goals = useLive(Q.goals) ?? [];
  const areas = useLive(Q.areas) ?? [];
  const [title, setTitle] = useState('');
  const [areaId, setAreaId] = useState('');
  const [date, setDate] = useState('');
  return (
    <>
      <Hint>מטרה היא משהו גדול, לשנה או לשנתיים. המטרה הראשונה נכנסת לפוקוס ומופיעה במסך היום.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const g = await createGoal({ title: title.trim(), areaId: areaId || undefined, targetDate: date || undefined });
          if (!goals.some((x) => x.inFocus)) await setFocusGoal(g.id); // R-GOL-2
          setTitle('');
          setDate('');
        }}
      >
        <input className="input" placeholder="למשל: לדבר ספרדית שוטפת" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="field">
          <label htmlFor="og-a">תחום</label>
          <AreaSelect id="og-a" value={areaId} onChange={setAreaId} />
        </div>
        <div className="field">
          <label htmlFor="og-d">תאריך יעד</label>
          <input id="og-d" type="date" className="mini-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="submit" className="btn primary block" disabled={!title.trim()}>
          הוסף מטרה
        </button>
      </form>
      <Added title="המטרות שלך" count={goals.length}>
        {goals.map((g) => (
          <AddedRow
            key={g.id}
            lead={g.inFocus ? <Icon name="star" size="sm" className="onb-star on" /> : <Icon name="mountain" size="sm" />}
            title={g.title}
            meta={[areas.find((a) => a.id === g.areaId)?.name, g.targetDate && formatDMY(g.targetDate)].filter(Boolean).join(' · ')}
            onDelete={() => void deleteGoal(g.id)}
          />
        ))}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Projects + milestones
// ---------------------------------------------------------------------------

function StepProjects() {
  const projects = useLive(Q.projects) ?? [];
  const goals = useLive(Q.goals) ?? [];
  const milestones = useLive(Q.milestones) ?? [];
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(PROJECT_ICONS[0]!);
  const [areaId, setAreaId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [status, setStatus] = useState<'active' | 'planning'>('active');
  return (
    <>
      <Hint>פרויקט הוא משהו עם סוף: אתר, מעבר דירה, קורס. אבני דרך הן השלבים הגדולים בדרך.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await createProject({ name: name.trim(), icon, areaId: areaId || undefined, goalId: goalId || undefined, status });
          setName('');
        }}
      >
        <input className="input" placeholder="למשל: אתר אישי" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="onb-icons" role="radiogroup" aria-label="אייקון">
          {PROJECT_ICONS.map((ic) => (
            <button key={ic} type="button" role="radio" aria-checked={icon === ic} className={icon === ic ? 'on' : ''} onClick={() => setIcon(ic)}>
              {ic}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="op-a">תחום</label>
          <AreaSelect id="op-a" value={areaId} onChange={setAreaId} />
        </div>
        {goals.length > 0 && (
          <div className="field">
            <label htmlFor="op-g">מטרה</label>
            <select id="op-g" className="mini-input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">בלי מטרה</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ margin: '8px 0' }}>
          <Seg value={status} onChange={setStatus} items={[{ id: 'active', label: 'בעבודה עכשיו' }, { id: 'planning', label: 'בתכנון' }]} />
        </div>
        <button type="submit" className="btn primary block" disabled={!name.trim()}>
          הוסף פרויקט
        </button>
      </form>
      <Added title="הפרויקטים שלך" count={projects.length}>
        {projects.map((p) => (
          <AddedRow key={p.id} lead={p.icon} title={p.name} meta={p.status === 'active' ? 'בעבודה' : 'תכנון'} onDelete={() => void deleteProject(p.id)}>
            <MilestonesMini projectId={p.id} list={milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.order - b.order)} />
          </AddedRow>
        ))}
      </Added>
    </>
  );
}

function MilestonesMini({ projectId, list }: { projectId: string; list: { id: string; title: string; dueDate?: string }[] }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  return (
    <div className="onb-sub">
      {list.map((m) => (
        <div key={m.id} className="onb-subrow">
          <Icon name="milestone" size="xs" />
          <span className="grow">{m.title}</span>
          {m.dueDate && <span className="muted">{formatDMY(m.dueDate)}</span>}
          <button type="button" className="muted" aria-label="מחק אבן דרך" onClick={() => void deleteMilestone(m.id)}>
            <Icon name="x" size="xs" />
          </button>
        </div>
      ))}
      <form
        className="addrow"
        style={{ marginTop: 4 }}
        onSubmit={async (e) => {
          e.preventDefault();
          await addMilestone(projectId, title, date || undefined);
          setTitle('');
          setDate('');
        }}
      >
        <input className="input" placeholder="+ אבן דרך" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="date" className="mini-input" aria-label="תאריך יעד" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 'none', width: 130 }} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Tasks
// ---------------------------------------------------------------------------

function useCurrentSprint(today: string) {
  const sprints = useLive(Q.sprints) ?? [];
  return sprints.find((s) => sprintStatus(s, today) === 'current');
}

function StepTasks({ today }: { today: string }) {
  const tasks = useLive(Q.tasks) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const cur = useCurrentSprint(today);
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<'inbox' | 'today' | 'week' | 'project'>('inbox');
  const [projectId, setProjectId] = useState('');
  const [star, setStar] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = tasks.filter((t) => !t.recurringId && !t.parentId && isOpen(t)).sort((a, b) => b.seq - a.seq);
  const top3Count = tasks.filter((t) => t.top3Date === today).length;
  const pid = projectId || projects[0]?.id || '';
  const dest: TaskDestination | undefined =
    where === 'week' ? (cur ? { kind: 'week', sprintId: cur.id } : undefined) : where === 'project' ? (pid ? { kind: 'project', projectId: pid } : undefined) : { kind: where };
  const placeOf = (t: (typeof list)[number]) =>
    t.dueDate === today ? 'היום' : t.dueDate ? formatDMY(t.dueDate) : t.sprintId ? 'השבוע' : t.projectIds.length ? (projects.find((p) => p.id === t.projectIds[0])?.name ?? 'פרויקט') : 'דואר נכנס';
  return (
    <>
      <Hint>הוצא מהראש כל מה שמחכה לך. לא צריך לסדר עכשיו: מה שנכנס לדואר הנכנס מסדרים אחר כך.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !dest) return;
          await addOnboardingTask(title, dest, star && top3Count < 3, today);
          setTitle('');
          setStar(false);
          input.current?.focus();
        }}
      >
        <div className="addrow" style={{ marginTop: 0 }}>
          <input ref={input} className="input" placeholder="למשל: להתקשר לבנק" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button
            type="button"
            className={`onb-starbtn ${star ? 'on' : ''}`}
            aria-pressed={star}
            aria-label="ל-3 החשובים היום"
            disabled={top3Count >= 3}
            onClick={() => setStar(!star)}
          >
            <Icon name="star" />
          </button>
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {(
            [
              ['inbox', 'דואר נכנס'],
              ['today', 'היום'],
              ['week', 'השבוע'],
              ['project', 'פרויקט'],
            ] as const
          ).map(([id, label]) =>
            id === 'project' && !projects.length ? null : (
              <button key={id} type="button" className={`chip ${where === id ? 'on' : 'out'}`} onClick={() => setWhere(id)}>
                {label}
              </button>
            ),
          )}
        </div>
        {where === 'project' && projects.length > 0 && (
          <div className="field">
            <label htmlFor="ot-p">איזה פרויקט</label>
            <select id="ot-p" className="mini-input" value={pid} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Hint>
          {star ? 'הכוכב מוסיף אותה ל-3 החשובים של היום.' : top3Count >= 3 ? '3 החשובים של היום כבר מלאים.' : 'כוכב = אחת מ-3 החשובות של היום.'}
        </Hint>
        <button type="submit" className="btn primary block" disabled={!title.trim() || !dest}>
          הוסף משימה
        </button>
      </form>
      <Added title="המשימות שלך" count={list.length}>
        {list.map((t) => (
          <AddedRow
            key={t.id}
            lead={t.top3Date === today ? <Icon name="star" size="sm" className="onb-star on" /> : <span className="sdot" />}
            title={t.title}
            meta={placeOf(t)}
            onDelete={() => void deleteTask(t.id)}
          />
        ))}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 7. This week (sprint)
// ---------------------------------------------------------------------------

function StepSprint({ today }: { today: string }) {
  const cur = useCurrentSprint(today);
  const tasks = useLive(Q.tasks) ?? [];
  if (!cur) return null;
  const open = tasks.filter((t) => isOpen(t) && !t.someday && !t.parentId && !t.recurringId);
  const inWeek = open.filter((t) => t.sprintId === cur.id);
  const backlog = open.filter((t) => !t.sprintId);
  return (
    <>
      <Hint>{cur.name}. כל שבוע נוצר ספרינט חדש לבד, ובסוף השבוע יש סקירה שבועית מודרכת.</Hint>
      <WeeklyGoals key={cur.id} sprintId={cur.id} initial={cur.weeklyGoals} />
      <Added title="משימות השבוע" count={inWeek.length}>
        {inWeek.map((t) => (
          <AddedRow
            key={t.id}
            lead={<span className="sdot" />}
            title={t.title}
            meta={
              <button type="button" className="minibtn" onClick={() => void addToSprint([t.id], undefined)}>
                הסר
              </button>
            }
          />
        ))}
      </Added>
      <Added title="משימות בלי שבוע" count={backlog.length}>
        {backlog.map((t) => (
          <AddedRow
            key={t.id}
            lead={<span className="sdot" />}
            title={t.title}
            meta={
              <button type="button" className="minibtn p" onClick={() => void addToSprint([t.id], cur.id)}>
                לשבוע הזה
              </button>
            }
          />
        ))}
      </Added>
    </>
  );
}

function WeeklyGoals({ sprintId, initial }: { sprintId: string; initial: string[] }) {
  const [goals, setGoals] = useState(() => [...initial, '', '', ''].slice(0, 3));
  return (
    <section className="card boxed">
      <h4>3 יעדים לשבוע</h4>
      <Hint>מה יהפוך את השבוע הזה להצלחה? מוצג בראש מסך הספרינט.</Hint>
      {goals.map((g, i) => (
        <div key={i} className="addrow" style={{ marginTop: 6 }}>
          <b className="num" style={{ color: 'var(--blue-text)', width: 18 }}>
            {i + 1}.
          </b>
          <input
            className="input"
            value={g}
            placeholder={['למשל: להעלות את האתר לאוויר', 'למשל: שני פרקים בספר', 'למשל: ארוחה עם המשפחה'][i]}
            onChange={(e) => {
              const next = goals.map((x, j) => (j === i ? e.target.value : x));
              setGoals(next);
              void setWeeklyGoals(sprintId, next);
            }}
          />
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. Recurring
// ---------------------------------------------------------------------------

function StepRecurring({ today }: { today: string }) {
  const list = useLive(Q.recurring) ?? [];
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'daily' | 'weekly'>('weekly');
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('');
  const rule: RecurrenceRule = type === 'daily' ? { type } : { type, days: days.length ? [...days].sort() : [0] };
  return (
    <>
      <Hint>משימה שחוזרת נוצרת לבד ביום שלה ומופיעה ב"הקבועים של היום". חודשי, שנתי וכל כמה שבועות: במסך החוזרות.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await saveRecurring({ title: title.trim(), rule, startDate: today, startTime: time || undefined, durationMin: time ? 30 : undefined });
          setTitle('');
          setTime('');
        }}
      >
        <input className="input" placeholder="למשל: לתת כביסה" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div style={{ margin: '8px 0' }}>
          <Seg value={type} onChange={setType} items={[{ id: 'daily', label: 'כל יום' }, { id: 'weekly', label: 'ימים בשבוע' }]} />
        </div>
        {type === 'weekly' && (
          <div className="chips">
            {HE_DAYS_SHORT.map((d, i) => (
              <button key={d} type="button" className={`chip ${days.includes(i) ? 'on' : 'out'}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>
                {d}
              </button>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="or-t">שעה (לא חובה)</label>
          <input id="or-t" type="time" className="mini-input ltr" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <p className="small" style={{ margin: '4px 0 8px', color: 'var(--blue-text)', fontWeight: 600 }}>
          {describeRule(rule)}
        </p>
        <button type="submit" className="btn primary block" disabled={!title.trim() || (type === 'weekly' && !days.length)}>
          הוסף משימה חוזרת
        </button>
      </form>
      <Added title="המשימות החוזרות שלך" count={list.length}>
        {list.map((r) => (
          <AddedRow key={r.id} lead={<Icon name="repeat" size="sm" />} title={r.title} meta={[describeRule(r.rule), r.startTime].filter(Boolean).join(' · ')} onDelete={() => void deleteRecurring(r.id)} />
        ))}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 9. Routines
// ---------------------------------------------------------------------------

const ROUTINE_IDEAS: Record<RoutineKind, string[]> = {
  morning: ['כוס מים', 'לסדר את המיטה', '10 דקות קריאה', 'לתכנן את היום', 'בלי טלפון בחצי שעה הראשונה'],
  evening: ['להכין דברים למחר', 'לכתוב 3 דברים טובים', 'מסכים כבויים', 'לתכנן את מחר', 'לקרוא לפני השינה'],
};

function StepRoutines() {
  const settings = useLive(Q.settings);
  const items = useLive(Q.routineItems) ?? [];
  if (!settings) return null;
  const r = settings.routines;
  const setR = async (patch: Partial<RoutineSettings>) => {
    const s = await getSettings();
    await updateSettings({ routines: { ...s.routines, ...patch } });
  };
  const time = (label: string, key: keyof RoutineSettings) => (
    <div className="field">
      <label htmlFor={`orr-${key}`}>{label}</label>
      <input id={`orr-${key}`} type="time" className="mini-input ltr" value={r[key] as string} onChange={(e) => e.target.value && void setR({ [key]: e.target.value })} />
    </div>
  );
  return (
    <>
      <Hint>השגרה מופיעה במסך היום רק בשעות שלה. שגרה בלי פריטים לא מופיעה בכלל.</Hint>
      {(['morning', 'evening'] as const).map((kind) => (
        <section key={kind} className="card boxed">
          <h4>
            <span className="t">
              <Icon name={kind === 'morning' ? 'sunrise' : 'moon'} size="sm" /> {kind === 'morning' ? 'שגרת בוקר' : 'שגרת ערב'}
            </span>
          </h4>
          {kind === 'morning' ? (
            <>
              {time('מתחילה ב-', 'morningStart')}
              {time('יוצא מהבית ב-', 'morningEnd')}
            </>
          ) : (
            <>
              {time('מופיעה מ-', 'eveningStart')}
              {time('עד', 'eveningEnd')}
            </>
          )}
          <RoutineItems kind={kind} items={items.filter((i) => i.routine === kind).sort((a, b) => a.order - b.order)} />
        </section>
      ))}
    </>
  );
}

function RoutineItems({ kind, items }: { kind: RoutineKind; items: { id: string; title: string }[] }) {
  const [text, setText] = useState('');
  const ideas = ROUTINE_IDEAS[kind].filter((x) => !items.some((i) => i.title === x));
  return (
    <>
      {items.map((it) => (
        <div key={it.id} className="onb-subrow">
          <span className="sq" />
          <span className="grow">{it.title}</span>
          <button type="button" className="muted" aria-label="מחק" onClick={() => void deleteRoutineItem(it.id)}>
            <Icon name="x" size="xs" />
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
        <input className="input" placeholder="+ פריט" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
      {ideas.length > 0 && (
        <div className="chips tight" style={{ marginTop: 8 }}>
          {ideas.map((x) => (
            <button key={x} type="button" className="chip out" onClick={() => void addRoutineItem(kind, x)}>
              + {x}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 10. Challenge
// ---------------------------------------------------------------------------

function StepChallenge({ today }: { today: string }) {
  const list = useLive(Q.challenges) ?? [];
  const [name, setName] = useState('');
  const [days, setDays] = useState(30);
  const [rules, setRules] = useState<string[]>(['']);
  return (
    <>
      <Hint>אתגר הוא תקופה עם חוקים. כל יום מסמנים במסך היום אם שמרת עליהם, ורואים רצף.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !rules.some((r) => r.trim())) return;
          await startChallenge(name, days, rules, today);
          setName('');
          setRules(['']);
        }}
      >
        <input className="input" placeholder="למשל: 30 יום של הרגלים טובים" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field">
          <span className="lab">כמה ימים</span>
          <span className="chips tight">
            {[7, 21, 30, 75, 90].map((d) => (
              <button key={d} type="button" className={`chip ${days === d ? 'on' : 'out'}`} onClick={() => setDays(d)}>
                {d}
              </button>
            ))}
          </span>
        </div>
        <Hint>מתחיל היום.</Hint>
        {rules.map((r, i) => (
          <div key={i} className="addrow" style={{ marginTop: 6 }}>
            <input
              className="input"
              placeholder={`חוק ${i + 1}, למשל "בלי סוכר"`}
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
        <button type="submit" className="btn primary block" style={{ marginTop: 10 }} disabled={!name.trim() || !rules.some((r) => r.trim())}>
          התחל אתגר
        </button>
      </form>
      <Added title="האתגרים שלך" count={list.length}>
        {list.map((c) => (
          <AddedRow key={c.id} lead={<Icon name="shield" size="sm" />} title={c.name} meta={`${c.rules.length} חוקים · עד ${formatDMY(c.endDate)}`} onDelete={() => void deleteChallenge(c.id)} />
        ))}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 11. People
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

function StepPeople() {
  const people = useLive(Q.people) ?? [];
  const agenda = useLive(Q.agenda) ?? [];
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(PERSON_EMOJIS[0]!);
  const [hasBday, setHasBday] = useState(false);
  const [bday, setBday] = useState({ day: 1, month: 1 });
  const [topic, setTopic] = useState('');
  return (
    <>
      <Hint>האנשים החשובים לך: על מה לדבר איתם בפעם הבאה, מה ממתין להם, ומתי יום ההולדת.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const p = await createPerson(name, emoji);
          if (hasBday) await updatePerson(p.id, { birthday: `${pad2(bday.month)}-${pad2(bday.day)}` });
          await addAgenda(p.id, topic);
          setName('');
          setTopic('');
          setHasBday(false);
        }}
      >
        <input className="input" placeholder="למשל: אמא" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="onb-icons" role="radiogroup" aria-label="אימוג'י">
          {PERSON_EMOJIS.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={emoji === x} className={emoji === x ? 'on' : ''} onClick={() => setEmoji(x)}>
              {x}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="opp-b">
            <input id="opp-b" type="checkbox" checked={hasBday} onChange={(e) => setHasBday(e.target.checked)} /> יום הולדת
          </label>
          {hasBday && <DayMonthPicker idPrefix="opp" day={bday.day} month={bday.month} onChange={(day, month) => setBday({ day, month })} />}
        </div>
        <input className="input" style={{ marginTop: 6 }} placeholder="נושא לדבר עליו בפעם הבאה (לא חובה)" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <button type="submit" className="btn primary block" style={{ marginTop: 10 }} disabled={!name.trim()}>
          הוסף אדם
        </button>
      </form>
      <Added title="האנשים שלך" count={people.length}>
        {people.map((p) => {
          const n = agenda.filter((a) => a.personId === p.id && !a.doneAt).length;
          return <AddedRow key={p.id} lead={p.emoji} title={p.name} meta={n ? `${n} נושאים` : undefined} onDelete={() => void deletePerson(p.id)} />;
        })}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 12. Notes
// ---------------------------------------------------------------------------

function StepNotes() {
  const notes = useLive(Q.notes) ?? [];
  const templates = (useLive(Q.templates) ?? []).filter((t) => t.kind === 'note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kinds, setKinds] = useState<NoteKind[]>([]);
  return (
    <>
      <Hint>מקום לרעיונות, סיכומי פגישות ומחשבות. אפשר להתחיל מתבנית.</Hint>
      <form
        className="card boxed"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() && !body.trim()) return;
          await createNote({ title: title.trim(), body, kinds });
          setTitle('');
          setBody('');
          setKinds([]);
        }}
      >
        <div className="chips tight" style={{ marginBottom: 8 }}>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip out"
              onClick={() => {
                setTitle(t.title);
                setBody(t.body);
              }}
            >
              <Icon name="note" size="xs" /> {t.name}
            </button>
          ))}
        </div>
        <input className="input" placeholder="כותרת" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" style={{ marginTop: 6, minHeight: 90 }} placeholder="מה רצית לרשום?" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="chips" style={{ margin: '8px 0' }}>
          {(['note', 'idea', 'meeting'] as const).map((k) => (
            <button key={k} type="button" className={`chip ${kinds.includes(k) ? 'on' : 'out'}`} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>
              {NOTE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="submit" className="btn primary block" disabled={!title.trim() && !body.trim()}>
          שמור פתק
        </button>
      </form>
      <Added title="הפתקים שלך" count={notes.length}>
        {notes.map((n) => (
          <AddedRow key={n.id} lead={<Icon name="note" size="sm" />} title={noteTitle(n)} meta={n.kinds.map((k) => NOTE_KIND_LABEL[k]).join(', ')} onDelete={() => void deleteNote(n.id)} />
        ))}
      </Added>
    </>
  );
}

// ---------------------------------------------------------------------------
// 13. Done
// ---------------------------------------------------------------------------

function StepDone({ name }: { name: string }) {
  const n = {
    goals: useLive(async () => (await Q.goals()).length) ?? 0,
    projects: useLive(async () => (await Q.projects()).length) ?? 0,
    tasks: useLive(async () => (await Q.tasks()).filter((t) => !t.recurringId).length) ?? 0,
    recurring: useLive(async () => (await Q.recurring()).length) ?? 0,
    routine: useLive(async () => (await Q.routineItems()).length) ?? 0,
    challenges: useLive(async () => (await Q.challenges()).length) ?? 0,
    people: useLive(async () => (await Q.people()).length) ?? 0,
    notes: useLive(async () => (await Q.notes()).length) ?? 0,
  };
  const tiles: [string, number][] = [
    ['מטרות', n.goals],
    ['פרויקטים', n.projects],
    ['משימות', n.tasks],
    ['חוזרות', n.recurring],
    ['פריטי שגרה', n.routine],
    ['אתגרים', n.challenges],
    ['אנשים', n.people],
    ['פתקים', n.notes],
  ];
  return (
    <>
      <p className="onb-done-h">{name.trim() ? `${name.trim()}, הכול מוכן.` : 'הכול מוכן.'}</p>
      <div className="onb-tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="stat">
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="plus" size="sm" /> רישום מהיר
          </span>
        </h4>
        <Hint>הכפתור השחור + נמצא בכל מסך. כל מה שעולה בראש, נרשם בשנייה.</Hint>
      </section>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="download" size="sm" /> לגבות מדי פעם
          </span>
        </h4>
        <Hint>הנתונים נשמרים רק במכשיר הזה. ב"עוד ← גיבוי וסנכרון" שומרים קובץ (למשל ב-iCloud), וכך גם עוברים בין הטלפון למחשב. אחרי שבוע בלי גיבוי תופיע תזכורת.</Hint>
      </section>
      <section className="card boxed">
        <h4>
          <span className="t">
            <Icon name="today" size="sm" /> להוסיף למסך הבית
          </span>
        </h4>
        <Hint>באייפון, בספארי: כפתור השיתוף ← "הוסף למסך הבית". כך האפליקציה נפתחת במסך מלא ועובדת גם בלי אינטרנט.</Hint>
      </section>
    </>
  );
}
