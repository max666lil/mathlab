/** Reactive notebook: every cell re-evaluates through the dependency graph. */
import { useState } from 'react';
import { useWs, useTopics } from '../hooks';
import { CellEditor } from './CellEditor';
import { CellOutput } from './CellOutput';

export function Notebook() {
  const ws = useWs();
  useTopics('doc');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const cells = ws.cells;

  const commit = (cellId: string) => {
    const i = cells.findIndex((c) => c.id === cellId);
    if (i === cells.length - 1) {
      const id = ws.addCell(cellId, '');
      setNewId(id);
    } else {
      setNewId(cells[i + 1].id);
    }
  };

  return (
    <div className="notebook">
      {cells.map((c, i) => (
        <div key={c.id} className={`cell ${focusId === c.id ? 'focused' : ''}`}>
          <div className="cell-index">{i + 1}</div>
          <div className="cell-main">
            <CellEditor cellId={c.id} autoFocus={newId === c.id} onCommit={commit} onFocus={(id) => {
              setFocusId(id);
              setNewId(null);
            }} />
            <CellOutput cellId={c.id} />
          </div>
          <div className="cell-actions">
            <button title="Move up" onClick={() => ws.moveCell(c.id, -1)} disabled={i === 0}>↑</button>
            <button title="Move down" onClick={() => ws.moveCell(c.id, 1)} disabled={i === cells.length - 1}>↓</button>
            <button title="Insert cell below" onClick={() => setNewId(ws.addCell(c.id, ''))}>＋</button>
            <button title="Delete cell" onClick={() => ws.removeCell(c.id)}>✕</button>
          </div>
        </div>
      ))}
      <button className="add-cell" onClick={() => setNewId(ws.addCell(undefined, ''))}>
        ＋ New cell
      </button>
    </div>
  );
}