import { useEffect, useRef, useState } from 'react';
import { diffDays, formatDMY, localDate } from '../../domain/dates';
import { backupFileName, BackupError, exportBackup, markBackupDone, parseBackup, restoreBackup, wipeAll, type ParsedBackup } from '../../services/backup';
import { assertNotDemo, exitDemo, loadDemo } from '../../services/demo';
import { ensureSeed, updateSettings } from '../../services/entity';
import { deleteArea, saveArea } from '../../services/misc';
import { runDaily } from '../../services/planning';
import { currentPosition, saveFile } from '../../services/platform';
import { Q } from '../../services/queries';
import { searchAll, type SearchHit } from '../../services/search';
import { describeWeather, refreshWeather, searchPlaces, type Place } from '../../services/weather';
import { confirmAction, Empty, TopBar, useToast } from '../components/common';
import { DraftInput } from '../components/edit';
import { Icon } from '../components/Icon';
import { useClock, useLive } from '../hooks';
import { go } from '../router';


export function MoreScreen() {
  const counts = {
    notes: useLive(async () => (await Q.notes()).length) ?? 0,
    challenges: useLive(async () => (await Q.challenges()).length) ?? 0,
    people: useLive(async () => (await Q.people()).length) ?? 0,
  };
  const row = (to: string, icon: string, label: string, end?: string, blue = false) => (
    <button type="button" className="listrow" onClick={() => go(to)}>
      <span className={`ic ${blue ? 'blue' : ''}`}>
        <Icon name={icon} size="sm" />
      </span>
      <span className="grow">{label}</span>
      <span className="end">
        {end}
        <Icon name="chev" size="xs" />
      </span>
    </button>
  );
  return (
    <div className="page">
      <TopBar title="עוד" stats={[{ v: counts.notes, k: 'פתקים' }, { v: counts.people, k: 'אנשים' }, { v: counts.challenges, k: 'אתגרים' }]} />
      <section className="card">
        {row('/notes', 'note', 'פתקים', counts.notes ? String(counts.notes) : undefined, true)}
        {row('/people', 'users', 'אנשים', counts.people ? String(counts.people) : undefined, true)}
        {row('/challenges', 'shield', 'אתגרים', counts.challenges ? String(counts.challenges) : undefined, true)}
        {row('/routines', 'sunrise', 'שגרות בוקר וערב', undefined, true)}
        {row('/recurring', 'repeat', 'משימות חוזרות', undefined, true)}
      </section>
      <section className="card">
        {row('/search', 'search', 'חיפוש')}
        {row('/tasks/matrix', 'grid', 'מטריצת דחוף / חשוב')}
        {row('/projects/goals', 'mountain', 'מטרות')}
        {row('/cleanup', 'archive', 'ניקוי משימות ישנות')}
        {row('/areas', 'tag', 'תחומים')}
      </section>
      <section className="card">
        {row('/backup', 'download', 'גיבוי וסנכרון')}
        {row('/weather', 'sun', 'מזג אוויר')}
        {row('/settings', 'settings', 'הגדרות ומצב הדגמה')}
      </section>
      <p className="muted small" style={{ textAlign: 'center' }}>
        Stay Focus · גרסה {__APP_VERSION__} · הכול נשמר במכשיר הזה בלבד
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search (SPEC 5.8)
// ---------------------------------------------------------------------------

const HIT_LABEL: Record<SearchHit['kind'], string> = { task: 'משימות', project: 'פרויקטים', note: 'פתקים', goal: 'מטרות', person: 'אנשים' };
const HIT_PATH: Record<SearchHit['kind'], string> = { task: '/task/', project: '/project/', note: '/note/', goal: '/goal/', person: '/person/' };

export function SearchScreen() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void searchAll(q).then((h) => live && setHits(h)), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const kinds = (Object.keys(HIT_LABEL) as SearchHit['kind'][]).filter((k) => hits.some((h) => h.kind === k));
  return (
    <div className="page sub">
      <TopBar title="חיפוש" backTo="/" />
      <input className="input" type="search" autoFocus placeholder="משימות, פרויקטים, פתקים, מטרות…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && !hits.length && <Empty icon="🔍">לא נמצא כלום.</Empty>}
      {kinds.map((k) => (
        <div key={k}>
          <div className="hit-kind">{HIT_LABEL[k]}</div>
          <section className="card">
            {hits
              .filter((h) => h.kind === k)
              .map((h) => (
                <button key={h.id} type="button" className="listrow" onClick={() => go(HIT_PATH[k] + h.id)}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{h.title}</span>
                    {h.snippet && <span className="muted small ellipsis" style={{ display: 'block' }}>{h.snippet}</span>}
                  </span>
                </button>
              ))}
          </section>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup & sync (SPEC 5.9)
// ---------------------------------------------------------------------------

const TABLE_LABELS: Partial<Record<keyof ParsedBackup['counts'], string>> = { tasks: 'משימות', projects: 'פרויקטים', notes: 'פתקים', goals: 'מטרות', sprints: 'ספרינטים', challenges: 'אתגרים', routineItems: 'פריטי שגרה', recurring: 'חוזרות', attachments: 'תמונות' };

export function BackupScreen() {
  const settings = useLive(Q.settings);
  const demo = useLive(Q.demo);
  const { today } = useClock();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedBackup>();
  const [error, setError] = useState<string>();
  const days = settings?.lastBackupAt ? diffDays(localDate(settings.lastBackupAt), today) : undefined;

  const doExport = async () => {
    setBusy(true);
    try {
      await assertNotDemo();
      const text = await exportBackup();
      await saveFile(backupFileName(today), text);
      await markBackupDone();
      toast({ message: 'הגיבוי נשמר' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ message: (e as Error).message === 'demo_mode' ? 'במצב הדגמה אי אפשר לגבות. צא ממצב הדגמה קודם.' : 'הגיבוי נכשל' });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setError(undefined);
    setParsed(undefined);
    try {
      setParsed(await parseBackup(await file.text()));
    } catch (e) {
      const code = e instanceof BackupError ? e.code : '';
      setError(code === 'newer_version' ? 'הגיבוי נוצר בגרסה חדשה יותר של האפליקציה. עדכן את האפליקציה במכשיר הזה ונסה שוב.' : code === 'not_a_backup' ? 'זה לא קובץ גיבוי של Stay Focus.' : 'הקובץ פגום ולא ניתן לשחזר ממנו.');
    }
  };

  const doRestore = async () => {
    if (!parsed) return;
    if (!confirmAction('השחזור יחליף את כל הנתונים במכשיר הזה בנתונים מהקובץ. להמשיך?')) return;
    if (!confirmAction('בטוח? את מה שיש עכשיו במכשיר אי אפשר יהיה להחזיר (אלא אם גיבית קודם).')) return;
    setBusy(true);
    try {
      await assertNotDemo();
      await restoreBackup(parsed);
      await ensureSeed();
      await runDaily(today);
      setParsed(undefined);
      toast({ message: 'הנתונים שוחזרו' });
      go('/');
    } catch (e) {
      toast({ message: (e as Error).message === 'demo_mode' ? 'צא ממצב הדגמה לפני שחזור.' : 'השחזור נכשל, שום דבר לא השתנה.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page sub">
      <TopBar
        title="גיבוי וסנכרון"
        backTo="/more"
        stats={[{ v: settings?.lastBackupAt ? (days ? `לפני ${days} ימים` : 'היום') : 'אף פעם', k: 'גיבוי אחרון' }]}
      />
      {demo && <div className="banner warn">אתה במצב הדגמה. גיבוי ושחזור חסומים עד שתחזיר את הנתונים שלך.</div>}
      <section className="card">
        <h4>
          <span className="t">
            <Icon name="download" size="sm" /> גיבוי
          </span>
          <small>{settings?.lastBackupAt ? `אחרון: ${formatDMY(localDate(settings.lastBackupAt))}${days ? ` (לפני ${days} ימים)` : ' (היום)'}` : 'עוד לא גובה'}</small>
        </h4>
        <p className="muted small" style={{ marginTop: 0 }}>
          קובץ אחד עם כל הנתונים והתמונות. באייפון בוחרים "שמור בקבצים" (למשל ב-iCloud Drive).
        </p>
        <button type="button" className="btn primary block" disabled={busy || !!demo} onClick={() => void doExport()}>
          <Icon name="download" size="sm" /> גבה עכשיו
        </button>
      </section>
      <section className="card">
        <h4>
          <span className="t">
            <Icon name="upload" size="sm" /> שחזור מקובץ
          </span>
        </h4>
        <p className="muted small" style={{ marginTop: 0 }}>
          מחליף את כל מה שיש במכשיר הזה בנתונים מהקובץ.
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        <button type="button" className="btn block" disabled={busy || !!demo} onClick={() => fileRef.current?.click()}>
          בחר קובץ גיבוי
        </button>
        {error && <div className="banner warn" style={{ marginTop: 10 }}>{error}</div>}
        {parsed && (
          <div style={{ marginTop: 12 }}>
            <p className="small" style={{ margin: '0 0 6px' }}>
              גיבוי מ-{formatDMY(localDate(parsed.exportedAt))}:
            </p>
            <div className="chips">
              {Object.entries(TABLE_LABELS).map(([k, label]) =>
                parsed.counts[k as keyof ParsedBackup['counts']] ? (
                  <span key={k} className="chip">
                    {label} <b className="num">{parsed.counts[k as keyof ParsedBackup['counts']]}</b>
                  </span>
                ) : null,
              )}
            </div>
            <button type="button" className="btn danger block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void doRestore()}>
              שחזר והחלף את הנתונים
            </button>
          </div>
        )}
      </section>
      <section className="card flat">
        <h4>
          <span className="t">
            <Icon name="info" size="sm" /> איך מסנכרנים בין הטלפון למחשב
          </span>
        </h4>
        <ol className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.7 }}>
          <li>במכשיר שבו עבדת אחרון: "גבה עכשיו", ושמור ב-iCloud Drive.</li>
          <li>במכשיר השני: "בחר קובץ גיבוי", ובחר את הקובץ החדש ביותר.</li>
          <li>אחרי השחזור שני המכשירים זהים. ממשיכים לעבוד באחד מהם.</li>
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weather (SPEC 5.10)
// ---------------------------------------------------------------------------

export function WeatherScreen() {
  const settings = useLive(Q.settings);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [msg, setMsg] = useState<string>();
  const choose = async (p: Place) => {
    await updateSettings({ weather: { placeName: p.name, lat: p.lat, lon: p.lon }, weatherCache: undefined });
    setResults([]);
    setQ('');
    await refreshWeather(true);
  };
  const cache = settings?.weatherCache;
  return (
    <div className="page sub">
      <TopBar title="מזג אוויר" sub={settings?.weather?.placeName ?? 'לא נבחר מיקום'} backTo="/more" stats={cache ? [{ v: <span className="ltr">{cache.tempC}°</span>, k: describeWeather(cache.code).text }] : undefined} />
      {settings?.weather && (
        <section className="card">
          <h4>
            <span className="t">
              <Icon name="location" size="sm" /> {settings.weather.placeName}
            </span>
            <button type="button" className="linkbtn" onClick={() => void updateSettings({ weather: undefined, weatherCache: undefined })}>
              הסר
            </button>
          </h4>
          {cache ? (
            <div className="row">
              <Icon name={describeWeather(cache.code).icon} />
              <b className="num" style={{ fontSize: 22 }}>{cache.tempC}°</b>
              <span>{describeWeather(cache.code).text}</span>
              <span className="muted small" style={{ marginInlineStart: 'auto' }}>
                עודכן {new Date(cache.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ) : (
            <p className="muted small">עוד אין נתונים. צריך אינטרנט.</p>
          )}
          <button type="button" className="btn block" style={{ marginTop: 10 }} onClick={() => void refreshWeather(true)}>
            רענן
          </button>
        </section>
      )}
      <section className="card">
        <h4>{settings?.weather ? 'להחליף מיקום' : 'בחר מיקום'}</h4>
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
              setMsg('אין חיבור לאינטרנט.');
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
          className="btn block ghost"
          style={{ marginTop: 6 }}
          onClick={async () => {
            setMsg(undefined);
            try {
              const pos = await currentPosition();
              await choose({ name: 'המיקום שלי', ...pos });
            } catch {
              setMsg('לא התקבלה הרשאת מיקום.');
            }
          }}
        >
          <Icon name="location" size="sm" /> השתמש במיקום שלי
        </button>
        {msg && <p className="muted small">{msg}</p>}
      </section>
      <p className="muted small" style={{ margin: '0 4px' }}>
        זה הדבר היחיד שיוצא מהמכשיר: קו רוחב ואורך נשלחים ל-Open-Meteo כדי לקבל טמפרטורה. שום נתון אחר לא נשלח.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings + demo mode (SPEC 5.11)
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const settings = useLive(Q.settings);
  const demo = useLive(Q.demo);
  const { today, now } = useClock();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!settings) return <div className="page sub" />;
  return (
    <div className="page sub">
      <TopBar title="הגדרות" backTo="/more" />
      <section className="card">
        <div className="field">
          <label htmlFor="un">השם שלך</label>
          <DraftInput className="mini-input" value={settings.userName} onSave={(v) => void updateSettings({ userName: v.trim() })} ariaLabel="השם שלך" />
        </div>
      </section>
      <div className="section-title">מצב הדגמה</div>
      <section className="card">
        {demo ? (
          <>
            <p className="small" style={{ marginTop: 0 }}>
              עכשיו מוצגים נתוני הדגמה. הנתונים שלך שמורים בצד וחוזרים בדיוק כמו שהיו.
            </p>
            <button
              type="button"
              className="btn primary block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await exitDemo();
                setBusy(false);
                toast({ message: 'הנתונים שלך חזרו' });
                go('/');
              }}
            >
              החזר את הנתונים שלי
            </button>
          </>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}>
              טוען נתונים לדוגמה (פרויקטים, ספרינטים, שגרה, אתגר) כדי לראות איך האפליקציה נראית מלאה. הנתונים שלך נשמרים בצד וחוזרים בלחיצה.
            </p>
            <button
              type="button"
              className="btn block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await loadDemo(today, now);
                  go('/');
                } catch {
                  toast({ message: 'טעינת ההדגמה נכשלה, הנתונים שלך לא השתנו' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sparkle" size="sm" /> טען נתוני הדגמה
            </button>
          </>
        )}
      </section>
      <div className="section-title">מחיקה</div>
      <section className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          מוחק את כל הנתונים במכשיר הזה ומתחיל מאפס. כדאי לגבות קודם.
        </p>
        <button
          type="button"
          className="btn danger block"
          disabled={!!demo || busy}
          onClick={async () => {
            if (!confirmAction('למחוק את כל הנתונים במכשיר הזה?')) return;
            if (!confirmAction('בטוח לגמרי? אי אפשר לבטל.')) return;
            await wipeAll();
            await ensureSeed();
            await runDaily(today);
            go('/');
          }}
        >
          מחק את כל הנתונים
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Areas and templates
// ---------------------------------------------------------------------------

const COLORS = ['#3346c4', '#16a34a', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#111111'];

export function AreasScreen() {
  const areas = useLive(Q.areas) ?? [];
  const [name, setName] = useState('');
  return (
    <div className="page sub">
      <TopBar title="תחומים" backTo="/more" />
      <p className="muted small" style={{ margin: '0 4px 10px' }}>
        תחומים מקבצים פרויקטים ומטרות (אישי, עבודה, משפחה…).
      </p>
      <section className="card">
        {areas.map((a) => (
          <div key={a.id} className="field">
            <span className="row grow">
              <select className="mini-input" aria-label="צבע" value={a.color} onChange={(e) => void saveArea({ ...a, color: e.target.value })} style={{ width: 44, background: a.color, color: 'transparent' }}>
                {COLORS.map((c) => (
                  <option key={c} value={c} style={{ background: c }}>
                    {c}
                  </option>
                ))}
              </select>
              <DraftInput className="mini-input grow" value={a.name} onSave={(v) => v.trim() && void saveArea({ ...a, name: v.trim() })} ariaLabel="שם התחום" />
            </span>
            <button type="button" className="muted" aria-label="מחק" onClick={() => confirmAction(`למחוק את "${a.name}"? הפרויקטים יישארו בלי תחום.`) && void deleteArea(a.id)}>
              <Icon name="trash" size="sm" />
            </button>
          </div>
        ))}
        <form
          className="addrow"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void saveArea({ name: name.trim(), color: COLORS[areas.length % COLORS.length]! });
            setName('');
          }}
        >
          <input className="input" placeholder="+ תחום חדש" value={name} onChange={(e) => setName(e.target.value)} />
        </form>
      </section>
    </div>
  );
}
