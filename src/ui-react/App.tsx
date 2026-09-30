/** Application shell: Worksheet | Canvas | Analysis. Everything else appears on demand. */
import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Workspace } from '../runtime/workspace';
import type { Presentation } from '../visualization/presentation';
import type { AnalysisService } from '../runtime/analysis';
import { WorkspaceContext, PresentationContext, AnalysisContext } from './hooks';
import { Notebook } from './notebook/Notebook';
import { CanvasPanel } from './panels/CanvasPanel';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { examples } from '../examples';
import { setTheme } from '../visualization/theme';
import { HelpDialog } from './Help';
import { PanelBoundary, UpdateBanner } from './ErrorBoundary';

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
        <select
          title="Examples"
          value=""
          onChange={(e) => {
            const ex = examples.find((x) => x.id === e.target.value);
            if (ex) ws.loadDocument(ex.cells);
          }}
        >
          <option value="" disabled>
            Examples…
          </option>
          {examples.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
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