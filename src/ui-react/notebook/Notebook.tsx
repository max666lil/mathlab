/**
 * Reactive notebook. Every cell re-evaluates through the dependency graph as you type.
 * Math mode shows definitions as mathematics (click a cell to edit its source); code mode shows
 * the editors.
 */
import { useState } from 'react';
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
  useTopics('doc');
  const [mode, setMode] = useState<'math' | 'code'>(loadMode);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const cells = ws.cells;

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

  return (
    <div className="panel notebook-panel">
      <div className="panel-header">
        <span className="panel-title">Notebook</span>
        <div className="seg">
          <button className={mode === 'math' ? 'active' : ''} onClick={() => switchMode('math')} title="Show definitions as mathematics">
            Math
          </button>
          <button className={mode === 'code' ? 'active' : ''} onClick={() => switchMode('code')} title="Show the MLL source of every cell">
            Code
          </button>
        </div>
        <span className="panel-sub">live</span>
      </div>
      <div className="panel-body scroll">
        <div className={`notebook ${mode}`}>
          {cells.map((c, i) => {
            const showEditor = mode === 'code' || editing === c.id || !c.source.trim();
            return (
              <div key={c.id} className={`cell ${focusId === c.id ? 'focused' : ''}`}>
                <div className="cell-index">{i + 1}</div>
                <div
                  className="cell-main"
                  onClick={(e) => {
                    if (showEditor) return;
                    if ((e.target as HTMLElement).closest('button, input, .chip')) return;
                    setEditing(c.id);
                    setNewId(c.id);
                  }}
                >
                  {showEditor && (
                    <CellEditor
                      cellId={c.id}
                      autoFocus={newId === c.id}
                      onCommit={commit}
                      onFocus={(id) => {
                        setFocusId(id);
                        setNewId(null);
                      }}
                      onBlur={(id) => {
                        setFocusId(null);
                        setEditing((cur) => (cur === id ? null : cur));
                      }}
                    />
                  )}
                  <CellOutput cellId={c.id} math={mode === 'math'} showComments={mode === 'math' && !showEditor} />
                </div>
                <div className="cell-actions">
                  <button title="Edit source" onClick={() => { setEditing(c.id); setNewId(c.id); }}>✎</button>
                  <button title="Move up" onClick={() => ws.moveCell(c.id, -1)} disabled={i === 0}>↑</button>
                  <button title="Move down" onClick={() => ws.moveCell(c.id, 1)} disabled={i === cells.length - 1}>↓</button>
                  <button title="Insert cell below" onClick={() => { const id = ws.addCell(c.id, ''); setEditing(id); setNewId(id); }}>＋</button>
                  <button title="Delete cell" onClick={() => ws.removeCell(c.id)}>✕</button>
                </div>
              </div>
            );
          })}
          <button className="add-cell" onClick={() => { const id = ws.addCell(undefined, ''); setEditing(id); setNewId(id); }}>
            ＋ New cell
          </button>
        </div>
      </div>
    </div>
  );
}