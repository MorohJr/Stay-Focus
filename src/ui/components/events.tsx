import { formatRelative } from '../../domain/dates';
import { eventsTimeline, occurrenceTime, REPEAT_LABEL, type Occurrence } from '../../domain/events';
import { Q } from '../../services/queries';
import { useClock, useLive } from '../hooks';
import { go } from '../router';
import { Icon } from './Icon';

/** R-EVT-6: "פגישות ואירועים" on a project or person page; nothing when there are none. */
export function LinkedEvents({ projectId, personId }: { projectId?: string; personId?: string }) {
  const { today } = useClock();
  const events = (useLive(Q.events) ?? []).filter((e) => (projectId && e.projectId === projectId) || (personId && e.personId === personId));
  if (!events.length) return null;
  const { upcoming, past } = eventsTimeline(events, today);
  const row = (o: Occurrence, done: boolean) => (
    <button key={`${o.event.id}:${o.date}`} type="button" className={`evrow ${done ? 'past' : ''}`} onClick={() => go(`/event/${o.event.id}/${o.date}`)}>
      <span className="when">
        {formatRelative(o.date, today)}
        <br />
        <span className="ltr num">{occurrenceTime(o)}</span>
      </span>
      <span className="grow">
        <b className="gt">{o.event.title}</b>
        <small>{[o.event.repeat !== 'none' ? REPEAT_LABEL[o.event.repeat] : '', o.event.location].filter(Boolean).join(' · ')}</small>
      </span>
    </button>
  );
  return (
    <>
      <div className="section-title">
        <span>
          <Icon name="cal" size="xs" /> פגישות ואירועים
        </span>
        <span className="num">{events.length}</span>
      </div>
      <section className="card">
        {upcoming.map((o) => row(o, false))}
        {past.map((o) => row(o, true))}
      </section>
    </>
  );
}
