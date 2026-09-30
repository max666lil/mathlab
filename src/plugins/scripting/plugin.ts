/** Scripts (Phase S) — value kinds for script results and text. */
import { definePlugin } from '../plugin-api';
import type { ScriptValue, TextValue } from '../../runtime/script/bridge';

const esc = (s: string) => s.replace(/[\\{}$&#^_%~]/g, (c) => `\\${c === '\\' ? 'backslash' : c}`).replace(/\\backslash/g, '\\textbackslash{}');

export const scriptingMath = definePlugin({
  name: 'scripting',
  install(api) {
    api.registerValueKind({
      kind: 'script',
      latex: (v) => {
        const s = v as unknown as ScriptValue;
        const vars = Object.keys(s.vars);
        const parts = [vars.length ? `${vars.length} variable${vars.length === 1 ? '' : 's'}` : '', s.figures.filter((f) => f.series.length).length ? `${s.figures.length} figure${s.figures.length === 1 ? '' : 's'}` : ''].filter(Boolean);
        return `\\text{script${s.name ? ` ${esc(s.name)}` : ''}${parts.length ? ': ' + parts.join(', ') : ''}}`;
      },
      typeLabel: () => 'script',
    });
    api.registerValueKind({
      kind: 'text',
      latex: (v) => `\\text{${esc((v as unknown as TextValue).text)}}`,
      typeLabel: () => 'text',
    });
  },
});