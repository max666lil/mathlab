import { describe, it, expect, beforeEach } from 'vitest';
import { listWorksheets, saveWorksheet, deleteWorksheet, getWorksheet, saveDraft, loadDraft } from '../src/runtime/worksheets';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

describe('saved worksheets', () => {
  it('save, overwrite, list newest first, delete', () => {
    const a = saveWorksheet('Bayes HW', ['P(A) = 0.3'])!;
    const b = saveWorksheet('  ', ['x = 1'])!;
    expect(b.title).toBe('Untitled');
    expect(listWorksheets().map((w) => w.id)).toEqual([b.id, a.id]);
    saveWorksheet('Bayes HW', ['P(A) = 0.4'], a.id);
    expect(listWorksheets()).toHaveLength(2);
    expect(getWorksheet(a.id)!.cells).toEqual(['P(A) = 0.4']);
    deleteWorksheet(b.id);
    expect(listWorksheets().map((w) => w.title)).toEqual(['Bayes HW']);
  });
  it('draft round trip; broken or missing storage is harmless', () => {
    saveDraft({ cells: ['f(x) = x^2'], worksheetId: 'ws-1' });
    expect(loadDraft()).toEqual({ cells: ['f(x) = x^2'], worksheetId: 'ws-1' });
    store.set('mathlab.worksheets', '{not json');
    expect(listWorksheets()).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(listWorksheets()).toEqual([]);
    expect(saveWorksheet('x', [])).toBeUndefined();
    expect(loadDraft()).toBeUndefined();
  });
});