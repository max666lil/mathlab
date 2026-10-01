import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './ui-react/styles.css';
import { installMathLab } from './setup';
import './plugins/core-calculus';
import './plugins/linear-algebra';
import './plugins/vector-calculus';
import './plugins/multivariable';
import './plugins/scripting';
import './plugins/statistics';
import { Workspace } from './runtime/workspace';
import { AnalysisService } from './runtime/analysis';
import { examples } from './examples';
import { loadDraft, saveDraft, getWorksheet } from './runtime/worksheets';
import { startClock } from './visualization/animation/clock';
import { App } from './ui-react/App';
import { Presentation } from './visualization/presentation';

installMathLab();
// reopen the last document (a reload does not lose work); otherwise the first demo
const draft = loadDraft();
const ws = new Workspace(draft && draft.cells.some((c) => c.trim()) ? draft.cells : examples[0].cells);
if (draft?.worksheetId && getWorksheet(draft.worksheetId)) ws.worksheetId = draft.worksheetId;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
ws.on('doc', () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft({ cells: ws.doc.cells.map((c) => c.source), worksheetId: ws.worksheetId ?? undefined }), 500);
});
const analysis = new AnalysisService(ws);
const pres = new Presentation(ws);
startClock(ws, pres);
// handy for debugging from the console
(window as unknown as { mathlab: Workspace }).mathlab = ws;

createRoot(document.getElementById('root')!).render(<App ws={ws} pres={pres} analysis={analysis} />);