/** Insight panel: explanation of the current concept, the numbers, and the selected object. */
import { useState } from 'react';
import { useWs, useTopics } from '../hooks';
import { Explanation } from '../explain/Explanations';
import { ValuesView } from './ValuesPanel';
import { InspectorView } from './InspectorPanel';

const TABS = [
  ['explain', 'Explain'],
  ['values', 'Values'],
  ['inspect', 'Inspector'],
] as const;

export function InsightPanel() {
  const ws = useWs();
  useTopics('selection');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('explain');
  return (
    <div className="panel">
      <div className="panel-header tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'inspect' && ws.selection ? <span className="tab-dot" /> : null}
          </button>
        ))}
      </div>
      <div className="panel-body scroll insight">
        {tab === 'explain' && <Explanation />}
        {tab === 'values' && <ValuesView />}
        {tab === 'inspect' && <InspectorView />}
      </div>
    </div>
  );
}