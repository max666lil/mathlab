/** Application shell: Worksheet | Canvas | Analysis. Everything else appears on demand. */
import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Workspace } from '../runtime/workspace';
import type { Presentation } from '../visualization/presentation';
import type { AnalysisService } from '../runtime/analysis';
import { WorkspaceContext, PresentationContext, AnalysisContext, useTopics } from './hooks';
import { Notebook } from './notebook/Notebook';
import { CanvasPanel } from './panels/CanvasPanel';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { examples } from '../examples';
import { listWorksheets, saveWorksheet, deleteWorksheet, onWorksheetsChange } from '../runtime/worksheets';
import { setTheme } from '../visualization/theme';
import { HelpDialog } from './Help';
import { PanelBoundary, UpdateBanner } from './ErrorBoundary';

const courses = [...new Set(examples.map((e) => e.course))];
const cellsOf = (ws: Workspace) => ws.doc.cells.map((c) => c.source);

/** Examples menu (own worksheets first, then the demos by course) and New / Save / Delete. */
function WorksheetBar({ ws }: { ws: Workspace }) {
  useTopics('doc');
  const [, bump] = useState(0);
  useEffect(() => onWorksheetsChange(() => bump((t) => t + 1)), []);
  const [naming, setNaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flash, setFlash] = useState('');
  const mine = listWorksheets();
  const current = ws.worksheetId ? mine.find((w) => w.id === ws.worksheetId) : undefined;
  const dirty = !!current && JSON.stringify(current.cells) !== JSON.stringify(cellsOf(ws));
  const show = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1500);
  };
  const saveAs = (title: string) => {
    const w = saveWorksheet(title, cellsOf(ws));
    if (!w) return show('cannot save (browser storage unavailable)');
    ws.worksheetId = w.id;
    setNaming(null);
    show('saved');
  };
  return (
    <>
      <select
        title="Examples and your saved worksheets"
        value={current ? current.id : ''}
        onChange={(e) => {
          setConfirmDelete(false);
          const w = mine.find((x) => x.id === e.target.value);
          if (w) return ws.loadDocument(w.cells, w.id);
          const ex = examples.find((x) => x.id === e.target.value);
          if (ex) ws.loadDocument(ex.cells);
        }}
      >
        <option value="" disabled>
          Examples…
        </option>
        {mine.length > 0 && (
          <optgroup label="My worksheets">
            {mine.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </optgroup>
        )}
        {courses.map((c) => (
          <optgroup key={c} label={`Demos — ${c}`}>
            {examples
              .filter((ex) => ex.course === c)
              .map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <button title="Start an empty worksheet" onClick={() => ws.loadDocument([''])}>
        New
      </button>
      {naming !== null ? (
        <form
          className="ws-name"
          onSubmit={(e) => {
            e.preventDefault();
            saveAs(naming);
          }}
        >
          <input autoFocus placeholder="worksheet title" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setNaming(null)}>
            ✕
          </button>
        </form>
      ) : current ? (
        <>
          <button
            title={`Save changes to “${current.title}”`}
            className={dirty ? 'dirty' : undefined}
            onClick={() => {
              saveWorksheet(current.title, cellsOf(ws), current.id);
              show('saved');
            }}
          >
            Save{dirty ? ' •' : ''}
          </button>
          <button title="Save a copy under a new title" onClick={() => setNaming(`${current.title} (copy)`)}>
            Save as
          </button>
          {confirmDelete ? (
            <button
              className="danger"
              onClick={() => {
                deleteWorksheet(current.id);
                ws.worksheetId = null;
                setConfirmDelete(false);
                show('deleted');
              }}
            >
              Delete “{current.title}”?
            </button>
          ) : (
            <button title="Delete this saved worksheet" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </>
      ) : (
        <button title="Save this worksheet in the browser (it appears under My worksheets)" onClick={() => setNaming('')}>
          Save
        </button>
      )}
      {flash && <span className="ws-flash">{flash}</span>}
    </>
  );
}

function Toolbar({ ws }: { ws: Workspace }) {
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [help, setHelp] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setTheme(theme);
  }, [theme]);
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">∂</span> MathLab
        <span className="tagline">mathematical analysis workbench</span>
      </div>
      <div className="toolbar-right">
        <WorksheetBar ws={ws} />
        <button onClick={() => setHelp(true)}>Language</button>
        <button onClick={() => setThemeState(theme === 'dark' ? 'light' : 'dark')} title="Toggle light/dark">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </header>
  );
}

export function App({ ws, pres, analysis }: { ws: Workspace; pres: Presentation; analysis: AnalysisService }) {
  return (
    <WorkspaceContext.Provider value={ws}>
      <PresentationContext.Provider value={pres}>
        <AnalysisContext.Provider value={analysis}>
          <div className="app">
            <Toolbar ws={ws} />
            <UpdateBanner />
            <Group orientation="horizontal" className="main">
              <Panel defaultSize="26" minSize="16">
                <PanelBoundary name="Worksheet">
                  <Notebook />
                </PanelBoundary>
              </Panel>
              <Separator className="sep sep-v" />
              <Panel defaultSize="46" minSize="25">
                <PanelBoundary name="Canvas">
                  <CanvasPanel />
                </PanelBoundary>
              </Panel>
              <Separator className="sep sep-v" />
              <Panel defaultSize="28" minSize="16">
                <PanelBoundary name="Analysis">
                  <AnalysisPanel />
                </PanelBoundary>
              </Panel>
            </Group>
          </div>
        </AnalysisContext.Provider>
      </PresentationContext.Provider>
    </WorkspaceContext.Provider>
  );
}