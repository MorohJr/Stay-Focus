import { db } from '../db/db';
import { noteTitle } from './planning';

/** SPEC 5.8: one box over tasks, projects, notes and goals. */

export interface SearchHit {
  kind: 'task' | 'project' | 'note' | 'goal';
  id: string;
  title: string;
  snippet?: string;
}

function snippet(body: string, q: string): string | undefined {
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return undefined;
  const from = Math.max(0, i - 30);
  return (from > 0 ? '…' : '') + body.slice(from, i + q.length + 50).replace(/\s+/g, ' ').trim() + '…';
}

export async function searchAll(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const has = (...s: (string | undefined)[]) => s.some((x) => x?.toLowerCase().includes(q));
  const [tasks, projects, notes, goals] = await Promise.all([db.tasks.toArray(), db.projects.toArray(), db.notes.toArray(), db.goals.toArray()]);
  const hits: SearchHit[] = [];
  for (const t of tasks) if (has(t.title, t.body, ...t.labels)) hits.push({ kind: 'task', id: t.id, title: t.title, snippet: snippet(t.body, q) });
  for (const p of projects) if (has(p.name, p.body)) hits.push({ kind: 'project', id: p.id, title: `${p.icon} ${p.name}`, snippet: snippet(p.body, q) });
  for (const n of notes) if (has(n.title, n.body)) hits.push({ kind: 'note', id: n.id, title: noteTitle(n), snippet: snippet(n.body, q) });
  for (const g of goals) if (has(g.title, g.body)) hits.push({ kind: 'goal', id: g.id, title: g.title, snippet: snippet(g.body, q) });
  return hits;
}
