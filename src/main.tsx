import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './ui-react/styles.css';
import { installMathLab } from './setup';
import './plugins/core-calculus';
import { Workspace } from './runtime/workspace';
import { flagship } from './examples';
import { startClock } from './visualization/animation/clock';
import { App } from './ui-react/App';

installMathLab();
const ws = new Workspace(flagship.cells);
startClock(ws);
// handy for debugging from the console
(window as unknown as { mathlab: Workspace }).mathlab = ws;

createRoot(document.getElementById('root')!).render(<App ws={ws} />);