/** CodeMirror support for MLL: highlighting, completion and Greek-letter shortcuts. */
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { getBuiltin, allBuiltins } from '../../math-core/builtins';
import { getScalarFunction, scalarFunctionNames } from '../../math-core/scalar-functions';

const KEYWORDS = new Set(['show', 'animate', 'from', 'to', 'over', 'at', 'draggable', 'hidden', 'point', 'vector', 'field', 'slider', 'function', 'direction', 'gradient', 'script', 'for', 'while', 'if', 'elseif', 'else', 'end', 'break', 'continue', 'return', 'and', 'in', 'order']);

export const mll = StreamLanguage.define<{ lineStart: boolean }>({
  name: 'mll',
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//') || stream.match('%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)) {
      state.lineStart = false;
      return 'number';
    }
    if (stream.match(/^[\p{L}_][\p{L}\d_']*/u)) {
      const w = stream.current();
      const first = state.lineStart;
      state.lineStart = false;
      if (KEYWORDS.has(w)) {
        if (['point', 'vector', 'field', 'function', 'direction', 'gradient'].includes(w) && first) state.lineStart = true;
        return 'keyword';
      }
      if (first && /^\s*(\(|=|∈)/.test(stream.string.slice(stream.pos))) return 'def';
      if (getBuiltin(w) || getScalarFunction(w)) return 'builtin';
      if (/^[α-ωΑ-Ω]/.test(w) || w === 'π' || w === 'e') return 'atom';
      return 'variable';
    }
    const ch = stream.next();
    state.lineStart = false;
    if (ch && '+-*/^=·×∇∈<>⟨⟩|'.includes(ch)) return 'operator';
    if (ch && '()[]{},.'.includes(ch)) return 'bracket';
    return null;
  },
  tokenTable: {
    def: t.definition(t.variableName),
    builtin: t.standard(t.variableName),
    atom: t.special(t.variableName),
    variable: t.variableName,
    bracket: t.bracket,
  },
});

export const mllHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: t.number, color: 'var(--syn-number)' },
    { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
    { tag: t.definition(t.variableName), color: 'var(--syn-def)', fontWeight: '600' },
    { tag: t.standard(t.variableName), color: 'var(--syn-builtin)' },
    { tag: t.special(t.variableName), color: 'var(--syn-atom)' },
    { tag: t.variableName, color: 'var(--syn-var)' },
    { tag: t.operator, color: 'var(--syn-op)' },
    { tag: t.bracket, color: 'var(--syn-bracket)' },
  ]),
);

const GREEK: [string, string][] = [
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['theta', 'θ'], ['lambda', 'λ'], ['mu', 'μ'],
  ['sigma', 'σ'], ['phi', 'φ'], ['psi', 'ψ'], ['omega', 'ω'], ['tau', 'τ'], ['rho', 'ρ'], ['pi', 'π'], ['nabla', '∇'], ['cdot', '·'],
  ['in', '∈'], ['Delta', 'Δ'], ['Sigma', 'Σ'], ['Omega', 'Ω'],
];

const KEYWORD_COMPLETIONS: Completion[] = [
  { label: 'show', type: 'keyword', detail: 'show objects in the views' },
  { label: 'animate', type: 'keyword', apply: 'animate θ from 0 to 2π', detail: 'animate a parameter' },
  { label: 'draggable', type: 'keyword', detail: 'make a point draggable' },
  { label: 'hidden', type: 'keyword', detail: 'create but hide' },
];

/** Completion source; `names` supplies the user's defined names. */
export function mllCompletions(names: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const greek = ctx.matchBefore(/\\[A-Za-z]*/);
    if (greek) {
      return {
        from: greek.from,
        options: GREEK.map(([name, ch]) => ({ label: `\\${name}`, detail: ch, apply: ch, type: 'text' })),
        validFor: /^\\[A-Za-z]*$/,
      };
    }
    const word = ctx.matchBefore(/[\p{L}_][\p{L}\d_']*/u);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const options: Completion[] = [
      ...allBuiltins().map((b) => ({ label: b.name, type: 'function', detail: b.signature, info: b.doc, apply: `${b.name}(`, boost: 2 })),
      ...scalarFunctionNames().map((n) => ({ label: n, type: 'function', apply: `${n}(` })),
      ...names().map((n) => ({ label: n, type: 'variable', boost: 3 })),
      ...KEYWORD_COMPLETIONS,
    ];
    return { from: word.from, options, validFor: /^[\p{L}_][\p{L}\d_']*$/u };
  };
}