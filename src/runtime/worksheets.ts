/**
 * The student's own worksheets, kept in the browser (localStorage): saved under a title, listed in the
 * Examples menu above the built-in demos. The current document is also kept as a draft, so a reload
 * does not lose work. Every storage access may fail (private windows, blocked storage): then nothing
 * is saved and the app works as before.
 */

export interface Worksheet {
  id: string;
  title: string;
  cells: string[];
  updated: number;
}

const LIST_KEY = 'mathlab.worksheets';
const DRAFT_KEY = 'mathlab.draft';

function read<T>(key: string): T | undefined {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isWorksheet = (w: unknown): w is Worksheet =>
  !!w && typeof (w as Worksheet).id === 'string' && typeof (w as Worksheet).title === 'string' && Array.isArray((w as Worksheet).cells);

const listeners = new Set<() => void>();
export function onWorksheetsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Saved worksheets, most recently changed first. */
export function listWorksheets(): Worksheet[] {
  const all = read<unknown[]>(LIST_KEY);
  return (Array.isArray(all) ? all.filter(isWorksheet) : []).sort((a, b) => b.updated - a.updated);
}

export function getWorksheet(id: string): Worksheet | undefined {
  return listWorksheets().find((w) => w.id === id);
}

/** Save (or overwrite, when `id` is given) a worksheet; returns it, or undefined when storage fails. */
export function saveWorksheet(title: string, cells: string[], id?: string): Worksheet | undefined {
  const w: Worksheet = { id: id ?? `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title: title.trim() || 'Untitled', cells: [...cells], updated: Date.now() };
  const rest = listWorksheets().filter((x) => x.id !== w.id);
  if (!write(LIST_KEY, [w, ...rest])) return undefined;
  changed();
  return w;
}

export function deleteWorksheet(id: string) {
  if (write(LIST_KEY, listWorksheets().filter((w) => w.id !== id))) changed();
}

export interface Draft {
  cells: string[];
  /** the saved worksheet the draft belongs to, if any */
  worksheetId?: string;
}

export function saveDraft(d: Draft) {
  write(DRAFT_KEY, d);
}

export function loadDraft(): Draft | undefined {
  const d = read<Draft>(DRAFT_KEY);
  return d && Array.isArray(d.cells) && d.cells.every((c) => typeof c === 'string') ? d : undefined;
}