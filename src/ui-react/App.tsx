/** Application shell: toolbar with concept modes + resizable layout of linked views. */
import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Workspace } from '../runtime/workspace';
import type { Presentation } from '../visualization/presentation';
import { getModes } from '../visualization/presentation';
import { WorkspaceContext, PresentationContext, useWs, useTopics } from './hooks';
import { Notebook } from './notebook/Notebook';
import { Scene3DPanel, Graph2DPanel, CrossSectionPanel } from './panels/ViewPanels';
import { InsightPanel } from './panels/InsightPanel';
import { examples } from '../examples';
import { setTheme } from '../visualization/theme';
import { HelpDialog } from './Help';

function ModeBar() {
  const ws = useWs();
  useTopics('view');
  return (
    <nav className="modebar" aria-label="Concept">
      {getModes().map((m, i) => (
        <button key={m.id} className={`mode ${ws.mode === m.id ? 'active' : ''}`} title={m.hint} onClick={() => ws.setMode(m.id)}>
          {m.id !== 'all' && <span className="mode-num">{i + 1}</span>}
          {m.title}
        </button>
      ))}
    </nav>
  );
}

function ModeHint() {
  const ws = useWs();
  useTopics('view');
  const m = getModes().find((x) => x.id === ws.mode);
  return <div className="mode-hint">{m?.hint}</div>;
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
      </div>
      <ModeBar />
      <div className="toolbar-right">
        <select
          title="Example"
          onChange={(e) => {
            const ex = examples.find((x) => x.id === e.target.value);
            if (ex) ws.loadDocument(ex.cells);
          }}
          defaultValue={examples[0].id}
        >
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

export function App({ ws, pres }: { ws: Workspace; pres: Presentation }) {
  // keyboard: 1–4 switch concept modes (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.cm-editor, input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = getModes()[Number(e.key) - 1];
      if (m) ws.setMode(m.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws]);
  return (
    <WorkspaceContext.Provider value={ws}>
      <PresentationContext.Provider value={pres}>
        <div className="app">
          <Toolbar ws={ws} />
          <ModeHint />
          <Group orientation="horizontal" className="main">
            <Panel defaultSize="25" minSize="16">
              <Notebook />
            </Panel>
            <Separator className="sep sep-v" />
            <Panel defaultSize="75" minSize="40">
              <Group orientation="vertical">
                <Panel defaultSize="62" minSize="25">
                  <Group orientation="horizontal">
                    <Panel defaultSize="50" minSize="20">
                      <Scene3DPanel />
                    </Panel>
                    <Separator className="sep sep-v" />
                    <Panel defaultSize="50" minSize="20">
                      <Graph2DPanel />
                    </Panel>
                  </Group>
                </Panel>
                <Separator className="sep sep-h" />
                <Panel defaultSize="38" minSize="12">
                  <Group orientation="horizontal">
                    <Panel defaultSize="40" minSize="15">
                      <CrossSectionPanel />
                    </Panel>
                    <Separator className="sep sep-v" />
                    <Panel defaultSize="60" minSize="20">
                      <InsightPanel />
                    </Panel>
                  </Group>
                </Panel>
              </Group>
            </Panel>
          </Group>
        </div>
      </PresentationContext.Provider>
    </WorkspaceContext.Provider>
  );
}