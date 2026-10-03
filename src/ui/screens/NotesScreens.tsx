import { useEffect, useState } from 'react';
import { formatRelative, localDate } from '../../domain/dates';
import type { NoteKind } from '../../domain/schemas';
import { createNote, deleteEmptyNotes, deleteNote, noteTitle, updateNote } from '../../services/planning';
import { Q } from '../../services/queries';
import { confirmAction, Empty, TopBar } from '../components/common';
import { DraftInput, DraftTextarea, LinksEditor, PhotosEditor } from '../components/edit';
import { Icon } from '../components/Icon';
import { ProjectPicker } from '../components/tasks';
import { useClock, useLive } from '../hooks';
import { back, go, replace } from '../router';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = { note: 'פתק', idea: 'רעיון', meeting: 'פגישה' };
const KINDS: NoteKind[] = ['note', 'idea', 'meeting'];

/** SPEC 5.6 */
export function NotesScreen() {
  const notes = useLive(Q.notes) ?? [];
  const projects = useLive(Q.projects) ?? [];
  const { today } = useClock();
  const [kind, setKind] = useState<NoteKind | 'all'>('all');
  const [q, setQ] = useState('');
  // An empty note left behind (created by "new note" and never filled) is removed.
  useEffect(() => void deleteEmptyNotes(), []);
  const list = notes
    .filter((n) => n.title.trim() || n.body.trim() || n.attachmentIds.length || n.links.length)
    .filter((n) => kind === 'all' || n.kinds.includes(kind))
    .filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="page">
      <TopBar title="פתקים" backTo="/more">
        <button type="button" className="iconbtn" aria-label="פתק חדש" onClick={() => go('/note/new')}>
          <Icon name="plus" />
        </button>
      </TopBar>
      <input className="input" placeholder="חיפוש בפתקים…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(['all', ...KINDS] as const).map((k) => (
          <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'הכול' : NOTE_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {!list.length && <Empty icon="🗒️">{notes.length ? 'לא נמצאו פתקים.' : 'עוד אין פתקים. אפשר לרשום מהר עם כפתור + ולבחור "פתק".'}</Empty>}
      {list.length > 0 && (
        <section className="card">
          {list.map((n) => {
            const proj = projects.filter((p) => n.projectIds.includes(p.id));
            return (
              <button key={n.id} type="button" className="listrow" onClick={() => go(`/note/${n.id}`)}>
                <span className="ic">{n.pinned ? '📌' : n.kinds.includes('idea') ? '💡' : n.kinds.includes('meeting') ? '🤝' : '🗒️'}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>
                    {noteTitle(n)}
                  </span>
                  <span className="muted small ellipsis" style={{ display: 'block' }}>
                    {formatRelative(localDate(n.updatedAt), today)}
                    {proj.length ? ` · ${proj.map((p) => p.name).join(', ')}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}

/** /note/new[/project:<id>] — pick a template, then open the note. */
export function NewNoteScreen({ preset }: { preset?: string }) {
  const templates = (useLive(Q.templates) ?? []).filter((t) => t.kind === 'note');
  const projectId = preset?.startsWith('project:') ? preset.slice(8) : undefined;
  const make = async (tplId?: string) => {
    const t = templates.find((x) => x.id === tplId);
    const n = await createNote({ title: t?.title ?? '', body: t?.body ?? '', projectIds: projectId ? [projectId] : [], kinds: t?.id === 'tpl-meeting' ? ['meeting'] : t?.id === 'tpl-brainstorm' ? ['idea'] : [] });
    replace(`/note/${n.id}`);
  };
  return (
    <div className="page sub">
      <TopBar title="פתק חדש" backTo="/notes" />
      <section className="card">
        <button type="button" className="listrow" onClick={() => void make()}>
          <span className="ic">🗒️</span>
          <span className="grow">פתק ריק</span>
        </button>
        {templates.map((t) => (
          <button key={t.id} type="button" className="listrow" onClick={() => void make(t.id)}>
            <span className="ic">
              <Icon name="layers" size="sm" />
            </span>
            <span className="grow">{t.name}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

export function NoteScreen({ id }: { id: string }) {
  const n = useLive(() => Q.note(id), [id]);
  const projects = useLive(Q.projects) ?? [];
  const [pick, setPick] = useState(false);
  if (n === undefined) return <div className="page sub" />;
  if (n === null) {
    return (
      <div className="page sub">
        <TopBar title="פתק" backTo="/notes" />
        <Empty icon="🔍">הפתק לא נמצא.</Empty>
      </div>
    );
  }
  const set = (patch: Parameters<typeof updateNote>[1]) => void updateNote(n.id, patch);
  const linked = projects.filter((p) => n.projectIds.includes(p.id));
  return (
    <div className="page sub">
      <TopBar title="" backTo="/notes">
        <button type="button" className="iconbtn" aria-label={n.pinned ? 'בטל נעיצה' : 'נעץ'} onClick={() => set({ pinned: !n.pinned })} style={{ color: n.pinned ? 'var(--blue)' : undefined }}>
          <Icon name="pin" />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="מחק פתק"
          onClick={async () => {
            if (!confirmAction('למחוק את הפתק?')) return;
            await deleteNote(n.id);
            back('/notes');
          }}
        >
          <Icon name="trash" />
        </button>
      </TopBar>
      <DraftInput className="title-input" value={n.title} onSave={(v) => set({ title: v })} placeholder="כותרת" autoFocus={!n.title && !n.body} />
      <div className="chips" style={{ margin: '10px 0 12px' }}>
        {KINDS.map((k) => (
          <button key={k} type="button" className={`chip ${n.kinds.includes(k) ? 'on' : 'out'}`} onClick={() => set({ kinds: n.kinds.includes(k) ? n.kinds.filter((x) => x !== k) : [...n.kinds, k] })}>
            {NOTE_KIND_LABEL[k]}
          </button>
        ))}
        <button type="button" className="chip out" onClick={() => setPick(true)}>
          <Icon name="folder" size="xs" /> {linked.length ? linked.map((p) => p.name).join(', ') : 'פרויקט'}
        </button>
      </div>
      <DraftTextarea value={n.body} onSave={(v) => set({ body: v })} placeholder="כתוב כאן…" rows={14} />
      <div className="section-title">קישורים</div>
      <section className="card">
        <LinksEditor links={n.links} onChange={(links) => set({ links })} />
      </section>
      <div className="section-title">תמונות</div>
      <PhotosEditor ownerType="note" ownerId={n.id} />
      <ProjectPicker open={pick} onClose={() => setPick(false)} selected={n.projectIds} onChange={(projectIds) => set({ projectIds })} />
    </div>
  );
}
