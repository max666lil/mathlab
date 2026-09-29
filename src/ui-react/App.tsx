/** Application shell: toolbar + resizable split layout of synchronized views. */
import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Workspace } from '../runtime/workspace';
import { WorkspaceContext } from './hooks';
import { Notebook } from './notebook/Notebook';
import { Scene3DPanel, Graph2DPanel, SlicePanel } from './panels/ViewPanels';
import { ValuesPanel } from './panels/ValuesPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { examples } from '../examples';
import { setTheme } from '../visualization/theme';
import { HelpDialog } from './Help';

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
        <span className="tagline">a laboratory for mathematics</span>
      </div>
      <div className="toolbar-mid">
        <label className="dim">Example</label>
        <select
          onChange={(e) => {
            const ex = examples.find((x) => x.id === e.target.value);
            if (ex) ws.loadDocument(ex.cells);
          }}
          defaultValue={examples[0].id}
        >
          {examples.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.course} — {ex.title}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-right">
        <button onClick={() => setHelp(true)}>Language</button>
        <button onClick={() => setThemeState(theme === 'dark' ? 'light' : 'dark')} title="Toggle light/dark">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </header>
  );
}

export function App({ ws }: { ws: Workspace }) {
  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="app">
        <Toolbar ws={ws} />
        <Group orientation="horizontal" className="main">
          <Panel defaultSize="31" minSize="18">
            <div className="panel notebook-panel">
              <div className="panel-header">
                <span className="panel-title">Notebook</span>
                <span className="panel-sub">reactive · Shift+Enter to run</span>
              </div>
              <div className="panel-body scroll">
                <Notebook />
              </div>
            </div>
          </Panel>
          <Separator className="sep sep-v" />
          <Panel defaultSize="69" minSize="30">
            <Group orientation="vertical">
              <Panel defaultSize="66" minSize="25">
                <Group orientation="horizontal">
                  <Panel defaultSize="56" minSize="20">
                    <Scene3DPanel />
                  </Panel>
                  <Separator className="sep sep-v" />
                  <Panel defaultSize="44" minSize="20">
                    <Group orientation="vertical">
                      <Panel defaultSize="62" minSize="20">
                        <Graph2DPanel />
                      </Panel>
                      <Separator className="sep sep-h" />
                      <Panel defaultSize="38" minSize="12">
                        <SlicePanel />
                      </Panel>
                    </Group>
                  </Panel>
                </Group>
              </Panel>
              <Separator className="sep sep-h" />
              <Panel defaultSize="34" minSize="10">
                <Group orientation="horizontal">
                  <Panel defaultSize="62" minSize="20">
                    <ValuesPanel />
                  </Panel>
                  <Separator className="sep sep-v" />
                  <Panel defaultSize="38" minSize="15">
                    <InspectorPanel />
                  </Panel>
                </Group>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </WorkspaceContext.Provider>
  );
}