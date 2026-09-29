/**
 * One notebook cell's editor (CodeMirror 6). Edits flow into the workspace; programmatic source
 * rewrites (dragging a point, moving a slider) flow back in without disturbing the cursor.
 */
import { useEffect, useRef } from 'react';
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { setDiagnostics } from '@codemirror/lint';
import { useWs } from '../hooks';
import { mll, mllHighlight, mllCompletions } from './mll-language';

const External = Annotation.define<boolean>();

interface Props {
  cellId: string;
  autoFocus?: boolean;
  onCommit(cellId: string): void;
  onFocus(cellId: string): void;
  onBlur?(cellId: string): void;
  /** Backspace in an empty row */
  onDeleteEmpty?(cellId: string): void;
  placeholder?: string;
}

export function CellEditor({ cellId, autoFocus, onCommit, onFocus, onBlur, onDeleteEmpty, placeholder }: Props) {
  const ws = useWs();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const cell = ws.doc.cell(cellId);
    if (!host.current || !cell) return;
    const commit = () => {
      ws.flush();
      onCommit(cellId);
      return true;
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: cell.source,
        extensions: [
          history(),
          drawSelection(),
          closeBrackets(),
          mll,
          mllHighlight,
          EditorView.lineWrapping,
          cmPlaceholder(placeholder ?? 'f(x) = x^3 - 3x'),
          autocompletion({ override: [mllCompletions(() => ws.statements().filter((s) => s.name).map((s) => s.name!))], icons: false }),
          keymap.of([
            { key: 'Enter', run: commit },
            { key: 'Mod-Enter', run: commit },
            { key: 'Shift-Enter', run: insertNewline },
            {
              key: 'Backspace',
              run: (v) => {
                if (v.state.doc.length || !onDeleteEmpty) return false;
                onDeleteEmpty(cellId);
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) ws.setCellSource(cellId, u.state.doc.toString());
            if (u.focusChanged && u.view.hasFocus) onFocus(cellId);
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();

    const syncText = () => {
      const src = ws.doc.cell(cellId)?.source;
      const cur = view.state.doc.toString();
      if (src === undefined || src === cur) return;
      // minimal replacement keeps the selection stable
      let a = 0;
      while (a < src.length && a < cur.length && src[a] === cur[a]) a++;
      let b = 0;
      while (b < src.length - a && b < cur.length - a && src[src.length - 1 - b] === cur[cur.length - 1 - b]) b++;
      view.dispatch({ changes: { from: a, to: cur.length - b, insert: src.slice(a, src.length - b) }, annotations: External.of(true) });
    };
    let lastDiag = '';
    const syncDiagnostics = () => {
      const len = view.state.doc.length;
      const diags = ws.diagnostics(cellId).map((d) => ({
        from: Math.min(d.from, len),
        to: Math.min(Math.max(d.to, d.from + 1), len),
        severity: d.severity,
        message: d.message,
      }));
      const key = JSON.stringify(diags);
      if (key === lastDiag) return;
      lastDiag = key;
      view.dispatch(setDiagnostics(view.state, diags));
    };
    syncDiagnostics();
    const u1 = ws.on('doc', () => {
      syncText();
      syncDiagnostics();
    });
    const u2 = ws.on('values', () => {
      if (!ws.playing.size) syncDiagnostics();
    });
    return () => {
      u1();
      u2();
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, cellId]);

  useEffect(() => {
    if (autoFocus) viewRef.current?.focus();
  }, [autoFocus]);

  return (
    <div
      className="cell-editor"
      ref={host}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.(cellId);
      }}
    />
  );
}