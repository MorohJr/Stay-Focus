import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { exitDemo } from '../services/demo';
import { ensureSeed } from '../services/entity';
import { runDaily } from '../services/planning';
import { requestPersistentStorage } from '../services/platform';
import { Q } from '../services/queries';
import { refreshWeather } from '../services/weather';
import { ToastProvider } from './components/common';
import { Icon } from './components/Icon';
import { QuickCapture } from './components/tasks';
import { useClock, useLive } from './hooks';
import { go, useRoute } from './router';
import { ChallengeScreen, ChallengesScreen, RecurringListScreen, RecurringScreen, RoutinesScreen } from './screens/HabitsScreens';
import { AreasScreen, BackupScreen, MoreScreen, SearchScreen, SettingsScreen, WeatherScreen } from './screens/MoreScreens';
import { CleanupScreen, PeopleScreen, PersonScreen } from './screens/PeopleScreens';
import { NewNoteScreen, NoteScreen, NotesScreen } from './screens/NotesScreens';
import { GoalScreen, NewProjectScreen, ProjectScreen, ProjectsScreen } from './screens/ProjectsScreen';
import { ReviewScreen, SprintScreen, SprintViewScreen } from './screens/SprintScreen';
import { NewTaskScreen, TaskScreen } from './screens/TaskScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TodayScreen } from './screens/TodayScreen';

const TABS = [
  { id: '', label: 'היום', icon: 'today' },
  { id: 'tasks', label: 'משימות', icon: 'tasks' },
  { id: 'sprint', label: 'ספרינט', icon: 'sprint' },
  { id: 'projects', label: 'פרויקטים', icon: 'target' },
  { id: 'more', label: 'עוד', icon: 'more' },
];
/** Screens that show the bottom nav and the + button. */
const MAIN = new Set(['', 'tasks', 'sprint', 'projects', 'more', 'notes', 'challenges', 'recurring', 'people']);
const OWNER: Record<string, string> = { notes: 'more', challenges: 'more', recurring: 'more', people: 'more' };

function screenFor(r: string[]): ReactNode {
  const [a = '', b, c] = r;
  switch (a) {
    case '':
      return <TodayScreen />;
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

  if (!ready) return null;
  const top = route[0] ?? '';
  const main = MAIN.has(top) && route.length <= 2;
  const activeTab = OWNER[top] ?? top;
  return (
    <ToastProvider>
      <div className="app">
        <UpdateBanner />
        <DemoBanner />
        {screenFor(route)}
        {main && (
          <>
            <button type="button" className="fab" aria-label="רישום מהיר" onClick={() => setCapture(true)}>
              <Icon name="plus" />
            </button>
            <nav className="nav" aria-label="ניווט ראשי">
              {TABS.map((t) => (
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
                </a>
              ))}
            </nav>
          </>
        )}
        <QuickCapture open={capture} onClose={() => setCapture(false)} />
      </div>
    </ToastProvider>
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
