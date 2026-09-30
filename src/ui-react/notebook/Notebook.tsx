/**
 * Worksheet: the reactive notebook in compact form — one statement per row, rendered as mathematics;
 * click a row to edit its source. There is always an empty row at the end to type into. Clicking a
 * definition makes it the analysed object.
 */
import { useEffect, useState } from 'react';
import { useWs, useTopics } from '../hooks';
import { CellEditor } from './CellEditor';
import { CellOutput } from './CellOutput';

function loadMode(): 'math' | 'code' {
  try {
    return localStorage.getItem('mathlab.notebookMode') === 'code' ? 'code' : 'math';
  } catch {
    return 'math';
  }
}

export function Notebook() {
  const ws = useWs();
  useTopics('doc', 'view');
  const [mode, setMode] = useState<'math' | 'code'>(loadMode);
  const [editing, setEditing] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const cells = ws.cells;

  // always keep an empty input row at the end
  useEffect(() => {
    const last = ws.cells[ws.cells.length - 1];
    if (!last || last.source.trim()) ws.addCell(last?.id, '');
  });

  const switchMode = (m: 'math' | 'code') => {
    setMode(m);
    try {
      localStorage.setItem('mathlab.notebookMode', m);
    } catch {
      /* private mode */
    }
  };

  const commit = (cellId: string) => {
    const i = cells.findIndex((c) => c.id === cellId);
    const next = i === cells.length - 1 ? ws.addCell(cellId, '') : cells[i + 1].id;
    setEditing(next);
    setNewId(next);
  };

  const removeEmpty = (cellId: string) => {
    const i = cells.findIndex((c) => c.id === cellId);
    if (cells.length <= 1 || i === cells.length - 1) return;
    const prev = cells[Math.max(0, i - 1)].id;
    ws.removeCell(cellId);
    setEditing(prev);
    setNewId(prev);
  };

  const definedNames = (cellId: string) => ws.statements().filter((s) => s.cellId === cellId && s.name).map((s) => s.name!);

  return (
    <div className="panel notebook-panel">
      <div className="panel-header">
        <span className="panel-title">Worksheet</span>
        <div className="spacer" />
        <div className="seg">
          <button className={mode === 'math' ? 'active' : ''} onClick={() => switchMode('math')} title="Show rows as mathematics">
            Math
          </button>
          <button className={mode === 'code' ? 'active' : ''} onClick={() => switchMode('code')} title="Show the source of every row">
            Code
          </button>
        </div>
      </div>
      <div className="panel-body scroll">
        <div className={`notebook ${mode}`}>
          {cells.map((c, i) => {
            const last = i === cells.length - 1;
            const showEditor = mode === 'code' || editing === c.id || !c.source.trim();
            const names = definedNames(c.id);
            const analysable = names.find((n) => ws.isAnalyzable(n));
            const focused = !!analysable && ws.focus === analysable;
            return (
              <div key={c.id} className={`cell ${focused ? 'focus-row' : ''} ${last ? 'input-row' : ''}`}>
                <div className="cell-index" title={analysable ? `Analyse ${analysable}` : undefined} onClick={() => analysable && ws.setFocus(analysable)}>
                  {analysable ? <span className={`focus-dot ${focused ? 'on' : ''}`}>◉</span> : last ? '›' : ''}
                </div>
                <div
                  className="cell-main"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, input, .chip')) return;
                    if (analysable) ws.setFocus(analysable);
                    if (showEditor) return;
                    setEditing(c.id);
                    setNewId(c.id);
                  }}
                >
                  {showEditor && (
                    <CellEditor
                      cellId={c.id}
                      autoFocus={newId === c.id}
                      placeholder={last ? (cells.length <= 1 ? 'Type math — e.g. f(x) = x^3 - 3x' : 'Type math or a command — e.g. critical f') : undefined}
                      onCommit={commit}
                      onFocus={() => setNewId(null)}
                      onBlur={(id) => setEditing((cur) => (cur === id ? null : cur))}
                      onDeleteEmpty={removeEmpty}
                    />
                  )}
                  <CellOutput cellId={c.id} math={mode === 'math'} showComments={mode === 'math' && !showEditor} />
                </div>
                {!last && (
                  <div className="cell-actions">
                    <button title="Edit source" onClick={() => { setEditing(c.id); setNewId(c.id); }}>✎</button>
                    <button title="Move up" onClick={() => ws.moveCell(c.id, -1)} disabled={i === 0}>↑</button>
                    <button title="Move down" onClick={() => ws.moveCell(c.id, 1)} disabled={i >= cells.length - 2}>↓</button>
                    <button title="Delete row" onClick={() => ws.removeCell(c.id)}>✕</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}