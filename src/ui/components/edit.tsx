import { useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, Link } from '../../domain/schemas';
import { addAttachment, deleteAttachment, linkLabel, normalizeLink } from '../../services/misc';
import { shrinkImage } from '../../services/platform';
import { Q } from '../../services/queries';
import { useLive } from '../hooks';
import { confirmAction } from './common';
import { Icon } from './Icon';

/** Text that saves itself: on blur, and 600ms after typing stops. Keeps typing smooth with live data. */
function useDraft(value: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  const flush = (v: string) => {
    clearTimeout(timer.current);
    if (dirty.current) {
      dirty.current = false;
      saveRef.current(v);
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: string) => {
    setDraft(v);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(v), 600);
  };
  return { draft, change, flush };
}

export function DraftInput({ value, onSave, className = 'input', placeholder, autoFocus, ariaLabel }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; autoFocus?: boolean; ariaLabel?: string }) {
  const { draft, change, flush } = useDraft(value, onSave);
  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => change(e.target.value)}
      onBlur={(e) => flush(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function DraftTextarea({ value, onSave, placeholder, rows = 5, className = 'textarea' }: { value: string; onSave: (v: string) => void; placeholder?: string; rows?: number; className?: string }) {
  const { draft, change, flush } = useDraft(value, onSave);
  return <textarea className={className} rows={rows} value={draft} placeholder={placeholder} aria-label={placeholder} onChange={(e) => change(e.target.value)} onBlur={(e) => flush(e.target.value)} />;
}

export function LinksEditor({ links, onChange }: { links: Link[]; onChange: (l: Link[]) => void }) {
  const [url, setUrl] = useState('');
  const add = () => {
    const l = normalizeLink(url);
    if (!l) return;
    onChange([...links, l]);
    setUrl('');
  };
  return (
    <div>
      {links.map((l, i) => (
        <div key={i} className="linkrow">
          <Icon name="link" size="sm" />
          <a className="grow ellipsis" href={l.url} target="_blank" rel="noreferrer noopener">
            {linkLabel(l)}
          </a>
          <button type="button" className="muted" aria-label="הסר קישור" onClick={() => onChange(links.filter((_, j) => j !== i))}>
            <Icon name="x" size="sm" />
          </button>
        </div>
      ))}
      <form
        className="addrow"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input" inputMode="url" placeholder="הדבק קישור…" value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" />
        <button type="submit" className="btn" disabled={!url.trim()}>
          הוסף
        </button>
      </form>
    </div>
  );
}

function Thumb({ a, onOpen }: { a: Attachment; onOpen: (url: string) => void }) {
  const url = useMemo(() => URL.createObjectURL(a.blob), [a.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="ph">
      {url && (
        <button type="button" style={{ display: 'block', width: '100%', height: '100%' }} onClick={() => onOpen(url)} aria-label={`הצג ${a.name}`}>
          <img src={url} alt={a.name} />
        </button>
      )}
      <button type="button" className="x" aria-label="מחק תמונה" onClick={() => confirmAction('למחוק את התמונה?') && void deleteAttachment(a.id)}>
        <Icon name="x" size="xs" />
      </button>
    </div>
  );
}

/** Photos from camera or gallery (SPEC 3.11). */
export function PhotosEditor({ ownerType, ownerId }: { ownerType: Attachment['ownerType']; ownerId: string }) {
  const list = useLive(() => Q.attachmentsOf(ownerId), [ownerId]) ?? [];
  const [viewing, setViewing] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="photos">
        {list.map((a) => (
          <Thumb key={a.id} a={a} onOpen={setViewing} />
        ))}
        <button type="button" className="addph" onClick={() => input.current?.click()} aria-label="הוסף תמונה">
          <Icon name="camera" />
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const f of files) await addAttachment(ownerType, ownerId, await shrinkImage(f), f.name);
        }}
      />
      {viewing && (
        <div className="viewer" onClick={() => setViewing(undefined)} role="dialog" aria-label="תמונה">
          <img src={viewing} alt="" />
        </div>
      )}
    </>
  );
}

export function LabelsEditor({ labels, onChange }: { labels: string[]; onChange: (l: string[]) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="chips" style={{ alignItems: 'center' }}>
      {labels.map((l) => (
        <button key={l} type="button" className="chip" onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`הסר תגית ${l}`}>
          #{l} <Icon name="x" size="xs" />
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim().replace(/^#/, '');
          if (t && !labels.includes(t)) onChange([...labels, t]);
          setText('');
        }}
        style={{ flex: 1, minWidth: 110 }}
      >
        <input className="mini-input" style={{ width: '100%', fontFamily: 'var(--font)' }} placeholder="+ תגית" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </div>
  );
}
