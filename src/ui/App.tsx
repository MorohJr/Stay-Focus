import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { needsOnboarding } from '../domain/onboarding';
import { exitDemo } from '../services/demo';
import { ensureSeed } from '../services/entity';
import { runDaily } from '../services/planning';
import { requestPersistentStorage } from '../services/platform';
import { Q } from '../services/queries';
import { refreshWeather } from '../services/weather';
import { ToastProvider } from './components/common';
import { reducedMotion, useGlass } from './design';
import { Icon } from './components/Icon';
import { QuickCapture } from './components/tasks';
import { useClock, useLive } from './hooks';
import { go, useRoute } from './router';
import { ChallengeScreen, ChallengesScreen, RecurringListScreen, RecurringScreen, RoutinesScreen } from './screens/HabitsScreens';
import { AreasScreen, BackupScreen, MoreScreen, SearchScreen, SettingsScreen, WeatherScreen } from './screens/MoreScreens';
import { CleanupScreen, PeopleScreen, PersonScreen } from './screens/PeopleScreens';
import { NewNoteScreen, NoteScreen, NotesScreen } from './screens/NotesScreens';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { GoalScreen, NewProjectScreen, ProjectScreen, ProjectsScreen } from './screens/ProjectsScreen';
import { ReviewScreen, SprintScreen, SprintViewScreen } from './screens/SprintScreen';
import { NewTaskScreen, TaskScreen } from './screens/TaskScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TodayScreen } from './screens/TodayScreen';
import { EventScreen, WeekScreen, WorkHoursScreen } from './screens/WeekScreens';
import { SummariesScreen, YearScreen } from './screens/YearScreens';

const TABS = [
  { id: '', label: 'היום', icon: 'today' },
  { id: 'week', label: 'שבוע', icon: 'cal' },
  { id: 'tasks', label: 'משימות', icon: 'tasks' },
  { id: 'sprint', label: 'ספרינט', icon: 'sprint' },
  { id: 'projects', label: 'פרויקטים', icon: 'target' },
];
/** Desktop tabs also show "more" (on the phone it's the gear at the top, R-NAV-1). */
const DTABS = [...TABS, { id: 'more', label: 'עוד', icon: 'more' }];
/** R-UI-12 (glass, desktop): quick actions on the dark rail. */
const RAIL = [
  { to: '/search', label: 'חיפוש', icon: 'search' },
  { to: '/tasks/inbox', label: 'דואר נכנס', icon: 'inbox' },
  { to: '/tasks/calendar', label: 'יומן', icon: 'cal' },
  { to: '/notes', label: 'פתקים', icon: 'note' },
  { to: '/people', label: 'אנשים', icon: 'users' },
  { to: '/challenges', label: 'אתגרים', icon: 'shield' },
  { sep: true },
  { to: '/backup', label: 'גיבוי', icon: 'download' },
  { to: '/settings', label: 'הגדרות', icon: 'settings' },
] as const;
/** Screens that show the bottom nav and the + button. */
const MAIN = new Set(['', 'week', 'tasks', 'sprint', 'projects', 'more', 'notes', 'challenges', 'recurring', 'people', 'summaries']);
const OWNER: Record<string, string> = { notes: 'more', challenges: 'more', recurring: 'more', people: 'more', summaries: 'more' };

function screenFor(r: string[]): ReactNode {
  const [a = '', b, c] = r;
  switch (a) {
    case '':
      return <TodayScreen />;
    case 'week':
      return <WeekScreen date={b} />;
    case 'event':
      return b === 'new' ? <EventScreen id="new" date={c} time={r[3]} /> : <EventScreen id={b!} />;
    case 'work-hours':
      return <WorkHoursScreen />;
    case 'tasks':
      return <TasksScreen tab={b} />;
    case 'task':
      return <TaskScreen id={b!} />;
    case 'new-task':
      return <NewTaskScreen preset={b} />;
    case 'sprint':
      return <SprintScreen tab={b} />;
    case 'sprint-view':
      return <SprintViewScreen id={b!} />;
    case 'review':
      return <ReviewScreen id={b} />;
    case 'projects':
      return <ProjectsScreen tab={b} />;
    case 'project':
      return b === 'new' ? <NewProjectScreen /> : <ProjectScreen id={b!} />;
    case 'goal':
      return <GoalScreen id={b!} />;
    case 'more':
      return <MoreScreen />;
    case 'notes':
      return <NotesScreen />;
    case 'note':
      return b === 'new' ? <NewNoteScreen preset={c} /> : <NoteScreen id={b!} />;
    case 'challenges':
      return <ChallengesScreen />;
    case 'challenge':
      return <ChallengeScreen id={b!} />;
    case 'routines':
      return <RoutinesScreen />;
    case 'recurring':
      return b ? <RecurringScreen id={b} /> : <RecurringListScreen />;
    case 'areas':
      return <AreasScreen />;
    case 'people':
      return <PeopleScreen />;
    case 'person':
      return <PersonScreen id={b!} />;
    case 'cleanup':
      return <CleanupScreen />;
    case 'search':
      return <SearchScreen />;
    case 'backup':
      return <BackupScreen />;
    case 'weather':
      return <WeatherScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'year':
      return <YearScreen year={b} />;
    case 'summaries':
      return <SummariesScreen />;
    default:
      return <TodayScreen />;
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const route = useRoute();
  const { today } = useClock();
  const [capture, setCapture] = useState(false);
  const lastDay = useRef<string>('');
  const settings = useLive(Q.settings);
  const demo = useLive(Q.demo);
  const glass = useGlass();
  // R-UI-11: a short loading skeleton when the app opens (glass look)
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWarm(true), reducedMotion() ? 0 : 650);
    return () => clearTimeout(t);
  }, []);

  // Start-up: defaults, daily jobs (R-SPR-1, R-REC-1), storage protection, weather.
  useEffect(() => {
    void (async () => {
      await ensureSeed();
      setReady(true);
      void requestPersistentStorage();
      void refreshWeather();
    })();
  }, []);

  // R-TOD-11: again whenever the date changes (midnight, or the app wakes up on a new day).
  useEffect(() => {
    if (!ready || lastDay.current === today) return;
    lastDay.current = today;
    void runDaily(today);
    void refreshWeather();
  }, [ready, today]);

  if (!ready || demo === undefined || (glass && !warm)) return glass ? <Skeleton /> : null;
  // R-ONB-1: first run, and again after "delete all data" (settings back to defaults).
  if (needsOnboarding(settings, demo))
    return (
      <ToastProvider>
        <div className="app">
          <UpdateBanner />
          <div className="inner">
            <OnboardingScreen />
          </div>
        </div>
      </ToastProvider>
    );
  const top = route[0] ?? '';
  const main = MAIN.has(top) && route.length <= 2;
  const activeTab = OWNER[top] ?? top;
  return (
    <ToastProvider>
      <div className="app">
        <UpdateBanner />
        <DemoBanner />
        {glass && <DesktopChrome active={activeTab} onCapture={() => setCapture(true)} />}
        <div className={top === '' ? 'today-wrap' : 'inner'}>{screenFor(route)}</div>
        {main && (
          <>
            {/* R-NAV-1: two tabs, the + in the middle, three tabs */}
            <nav className="nav" aria-label="ניווט ראשי">
              {TABS.map((t, i) => [
                i === 2 && (
                  <button key="add" type="button" className="fab" aria-label="רישום מהיר" onClick={() => setCapture(true)}>
                    <Icon name="plus" />
                  </button>
                ),
                <a
                  key={t.id}
                  href={`#/${t.id}`}
                  className={activeTab === t.id ? 'on' : ''}
                  aria-current={activeTab === t.id ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(`/${t.id}`);
                  }}
                >
                  <Icon name={t.icon} />
                  {t.label}
                </a>,
              ])}
            </nav>
          </>
        )}
        <QuickCapture open={capture} onClose={() => setCapture(false)} />
      </div>
    </ToastProvider>
  );
}

/** R-DSK-1 / R-UI-12: on a wide screen, the main tabs on top and a dark rail of quick actions. CSS shows it from 1024px. */
function DesktopChrome({ active, onCapture }: { active: string; onCapture: () => void }) {
  return (
    <>
      <header className="dtop">
        <span className="dbrand">
          <i aria-hidden="true">
            <b />
          </i>
          Stay Focus
        </span>
        <nav className="dtabs" aria-label="מסכים">
          {DTABS.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              className={active === t.id ? 'on' : ''}
              aria-current={active === t.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(`/${t.id}`);
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <aside className="rail" aria-label="פעולות מהירות">
        <button type="button" className="add" aria-label="רישום מהיר" data-tip="רישום מהיר" onClick={onCapture}>
          <Icon name="plus" />
        </button>
        <i className="sep" />
        {RAIL.map((r, i) =>
          'sep' in r ? (
            <i key={i} className="sep" />
          ) : (
            <button key={r.to} type="button" aria-label={r.label} data-tip={r.label} onClick={() => go(r.to)}>
              <Icon name={r.icon} />
            </button>
          ),
        )}
      </aside>
    </>
  );
}

/** R-UI-11: shimmering placeholders: a title, a row of numbers, a few cards. */
function Skeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="טוען">
      <div className="page skel">
        <i className="sk" style={{ height: 22, width: '38%' }} />
        <i className="sk" style={{ height: 40, width: '62%', marginTop: 10 }} />
        <div className="sk-row">
          <i className="sk sk-c" />
          <i className="sk sk-c" />
          <i className="sk sk-c" />
        </div>
        <div className="sk-grid">
          <i className="sk" style={{ height: 190 }} />
          <i className="sk" style={{ height: 150 }} />
          <i className="sk" style={{ height: 150 }} />
          <i className="sk" style={{ height: 120 }} />
        </div>
      </div>
    </div>
  );
}

/** SPEC 5.12: update only when the user taps. */
function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="update" role="status">
      <div>
        <span className="grow">
          <b style={{ display: 'block' }}>גרסה חדשה זמינה</b>
          <span className="small" style={{ opacity: 0.8 }}>
            הנתונים שלך לא ייפגעו
          </span>
        </span>
        <button type="button" className="minibtn p" onClick={() => void updateServiceWorker(true)}>
          עדכן
        </button>
        <button type="button" aria-label="סגור" onClick={() => setNeedRefresh(false)} style={{ color: '#fff', padding: 6 }}>
          <Icon name="x" size="sm" />
        </button>
      </div>
    </div>
  );
}

/** SPEC 5.11: a permanent banner while demo data is shown. */
function DemoBanner() {
  const demo = useLive(Q.demo);
  if (!demo) return null;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'calc(var(--safe-t) + 8px) 15px 0' }}>
      <div className="banner dark" style={{ marginBottom: 0 }}>
        <Icon name="sparkle" size="sm" />
        <span className="grow">מצב הדגמה: אלה לא הנתונים שלך</span>
        <button
          type="button"
          className="minibtn p"
          onClick={async () => {
            await exitDemo();
            go('/');
          }}
        >
          החזר את הנתונים שלי
        </button>
      </div>
    </div>
  );
}
