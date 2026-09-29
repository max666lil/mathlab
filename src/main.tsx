import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './ui-react/styles.css';
import { installMathLab } from './setup';
import './plugins/core-calculus';
import { Workspace } from './runtime/workspace';
import { AnalysisService } from './runtime/analysis';
import { examples } from './examples';
import { startClock } from './visualization/animation/clock';
import { App } from './ui-react/App';
import { Presentation } from './visualization/presentation';

installMathLab();
const ws = new Workspace(examples[0].cells);
const analysis = new AnalysisService(ws);
const pres = new Presentation(ws);
startClock(ws, pres);
// handy for debugging from the console
(window as unknown as { mathlab: Workspace }).mathlab = ws;

createRoot(document.getElementById('root')!).render(<App ws={ws} pres={pres} analysis={analysis} />);