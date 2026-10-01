import { describe, it, expect } from 'vitest';
import { parseScript } from '../src/runtime/script/parser';
import { Interpreter } from '../src/runtime/script/interp';
import { Arr, SV } from '../src/runtime/script/values';
import { beforeAll } from 'vitest';
import { installMathLab } from '../src/setup';
import { Workspace } from '../src/runtime/workspace';
import { AnalysisService } from '../src/runtime/analysis';
import { toText } from '../src/math-core/symbolic/print';
import { findBlocks, openBlocks } from '../src/parser/blocks';

beforeAll(() => installMathLab());

function run(src: string, host: Record<string, SV> = {}) {
  const it = new Interpreter({ lookup: (n) => host[n] });
  it.run(parseScript(src));
  return it;
}
const arr = (v: SV | undefined) => (v instanceof Arr ? Array.from(v.d) : v);

describe('script language: syntax and arrays', () => {
  it('literals, ranges, element-wise and matrix products', () => {
    const it = run('a = [1 2 3]; b = [1, 2; 3, 4]; c = 1:2:7; d = a .* a; e = b * b; f = b\'; g = [1 -2]; h = [1 - 2];');
    expect(arr(it.vars.get('a'))).toEqual([1, 2, 3]);
    expect(arr(it.vars.get('c'))).toEqual([1, 3, 5, 7]);
    expect(arr(it.vars.get('d'))).toEqual([1, 4, 9]);
    expect((it.vars.get('e') as Arr).rows()).toEqual([[7, 10], [15, 22]]);
    expect((it.vars.get('f') as Arr).rows()).toEqual([[1, 3], [2, 4]]);
    expect(arr(it.vars.get('g'))).toEqual([1, -2]);
    expect(it.vars.get('h')).toBe(-1);
  });
  it('precedence: -2^2, 2^-1, 2^3^2, a:b+1', () => {
    const it = run('p = -2^2; q = 2^-1; r = 2^3^2; s = 1:2+1;');
    expect(it.vars.get('p')).toBe(-4);
    expect(it.vars.get('q')).toBe(0.5);
    expect(it.vars.get('r')).toBe(64);
    expect(arr(it.vars.get('s'))).toEqual([1, 2, 3]);
  });
  it('indexing: end, colon, masks, growth, deletion', () => {
    const it = run('v = 10:10:50; a = v(end); b = v(2:end); m = [1 2; 3 4]; c = m(:, 2); d = m(2, :); w = v(v > 25); z = []; z(3) = 7; v(2) = [];');
    expect(it.vars.get('a')).toBe(50);
    expect(arr(it.vars.get('b'))).toEqual([20, 30, 40, 50]);
    expect(arr(it.vars.get('c'))).toEqual([2, 4]);
    expect(arr(it.vars.get('d'))).toEqual([3, 4]);
    expect(arr(it.vars.get('w'))).toEqual([30, 40, 50]);
    expect(arr(it.vars.get('z'))).toEqual([0, 0, 7]);
    expect(arr(it.vars.get('v'))).toEqual([10, 30, 40, 50]);
  });
  it('control flow and functions', () => {
    const it = run(`
      function s = partialsum(n)
        s = 0;
        for k = 1:n
          s = s + 1/k^2;
        end
      end
      function [m, M] = extremes(v)
        m = min(v); M = max(v);
      end
      total = partialsum(1000);
      [lo, hi] = extremes([4 9 1 7]);
      count = 0; x = 27;
      while x ~= 1
        if mod(x, 2) == 0
          x = x / 2;
        else
          x = 3*x + 1;
        end
        count = count + 1;
      end
    `);
    expect(it.vars.get('total')).toBeCloseTo(1.6439345666815615, 12);
    expect([it.vars.get('lo'), it.vars.get('hi')]).toEqual([1, 9]);
    expect(it.vars.get('count')).toBe(111);
  });
  it('anonymous functions, integral, fzero, trapz, polyfit', () => {
    const it = run('f = @(x) exp(-x.^2); I = integral(f, -10, 10); r = fzero(@(x) x^3 - 2, 1); t = trapz(0:0.001:1, (0:0.001:1).^2); p = polyfit([1 2 3], [1 1 3], 1);');
    expect(it.vars.get('I')).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(it.vars.get('r')).toBeCloseTo(Math.cbrt(2), 12);
    expect(it.vars.get('t')).toBeCloseTo(1 / 3, 6);
    // least-squares line through (1,1), (2,1), (3,3): m = 1, b = −1/3 (Hughes-Hallett §15.2)
    const p = arr(it.vars.get('p')) as number[];
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(-1 / 3, 12);
  });
  it('seeded randomness is reproducible; simulation estimates a probability', () => {
    const src = 'rng(1); x = rand(1, 20000); phat = mean(x < 0.3);';
    const a = run(src);
    const b = run(src);
    expect(a.vars.get('phat')).toBe(b.vars.get('phat'));
    expect(a.vars.get('phat') as number).toBeGreaterThan(0.28);
    expect(a.vars.get('phat') as number).toBeLessThan(0.32);
    expect(a.usedRandom).toBe(true);
    const z = run('rng(2); z = randn(1, 50000); m = mean(z); s = std(z);');
    expect(Math.abs(z.vars.get('m') as number)).toBeLessThan(0.02);
    expect(z.vars.get('s') as number).toBeCloseTo(1, 1);
  });
  it('output and figures', () => {
    const it = run("x = 3\nfprintf('x = %d, half = %.2f\\n', x, x/2); disp('done'); plot(1:3, [1 4 9]); hist(randn(1, 1000), 20); title('demo')");
    expect(it.output).toEqual(['x = 3', 'x = 3, half = 1.50', 'done']);
    expect(it.figures[0].series.map((s) => s.type)).toEqual(['line', 'bar']);
    expect(it.figures[0].title).toBe('demo');
  });
  it('errors: endless loops stop, sizes are checked, names are reported', () => {
    expect(() => new Interpreter({ lookup: () => undefined }, 10000).run(parseScript('while true\nend'))).toThrow(/stopped after/);
    expect(() => run('a = [1 2] + [1 2 3];')).toThrow(/sizes do not match/);
    expect(() => run('y = undefinedThing + 1;')).toThrow(/undefined name 'undefinedThing'/);
  });
  it('worksheet values are visible', () => {
    const it = run('y = a * 2;', { a: 21 });
    expect(it.vars.get('y')).toBe(42);
  });
});

describe('scripts in the worksheet', () => {
  const val = (ws: Workspace, id: string) => ws.node(id)?.value as any;
  const err = (ws: Workspace, id: string) => ws.node(id)?.error?.message;
  it('finds blocks and open blocks', () => {
    expect(findBlocks('a = 1\nfor k = 1:3\n  s = k;\nend\nb = 2')).toEqual([{ from: 6, to: 30 }]);
    expect(findBlocks('x = v(end)')).toEqual([]);
    expect(openBlocks('script s\n  for k = 1:3\n')).toBe(2);
    expect(openBlocks('script s\n  for k = 1:3\n  end\nend')).toBe(0);
  });
  it('a one-line function block is a symbolic function; a loop is a numeric one', () => {
    const ws = new Workspace(['function y = sq(x)\n  y = x.^2 + 1;\nend', 'sq(3)', 'function s = psum(n)\n  s = 0;\n  for k = 1:n\n    s = s + 1/k^2;\n  end\nend', 'psum(100)']);
    const sq = val(ws, 'sq');
    expect(sq.kind).toBe('function');
    expect(toText(sq.expr)).toBe('x^2 + 1');
    const sts = ws.statements();
    expect(val(ws, sts[1].id).value).toBe(10);
    expect(val(ws, sts[3].id).value).toBeCloseTo(1.6349839001848923, 12);
    // the symbolic one is analysed like any f(x)
    ws.setFocus('sq');
    expect(new AnalysisService(ws).plan()?.typeLabel).toMatch(/function/);
  });
  it('a script leaves its variables in the worksheet (seeded simulation)', () => {
    const ws = new Workspace(['n = 2000', "script sim\n  rng(1);\n  x = rand(1, n);\n  phat = mean(x < 0.3);\n  fprintf('p ≈ %.3f\\n', phat);\n  hist(x, 20)\nend", 'q = phat * 100']);
    const s = val(ws, 'sim');
    expect(s.kind).toBe('script');
    expect(s.output[0]).toMatch(/^p ≈ 0\.[23]/);
    const phat = val(ws, 'phat');
    expect(phat.kind).toBe('scalar');
    expect(phat.certainty).toBe('heuristic');
    // n comes from the worksheet; a constant assigned in a script is not random
    const ws2 = new Workspace(['script b\n  rng(7); trials = 200; hits = 0;\n  for t = 1:trials\n    v = randi(365, 1, 23);\n    if numel(unique(v)) < 23\n      hits = hits + 1;\n    end\n  end\nend']);
    expect(val(ws2, 'trials').certainty).toBe('numeric');
    expect(val(ws2, 'hits').certainty).toBe('heuristic');
    expect(val(ws, 'x').items.length).toBe(2000);
    expect(val(ws, ws.statements()[ws.statements().length - 1].id).value).toBeCloseTo(phat.value * 100, 12);
    // the figure is on the canvas
    expect(ws.sceneItems().some((i) => i.visual.vtype === 'figure')).toBe(true);
    // editing n re-runs the script (it depends on n)
    ws.setCellSource(ws.doc.cells[0].id, 'n = 10', true);
    ws.flush();
    expect(val(ws, 'x').items.length).toBe(10);
  });
  it('worksheet functions are callable (element-wise) inside scripts; lambdas come back symbolic', () => {
    const ws = new Workspace(['f(x) = x^2', 'script t\n  a = f(3);\n  v = f([1 2 3]);\n  g = @(x) exp(-x.^2);\nend']);
    expect(val(ws, 'a').value).toBe(9);
    expect(val(ws, 'v').items.map((i: any) => i.value)).toEqual([1, 4, 9]);
    const g = val(ws, 'g');
    expect(g.kind).toBe('function');
    expect(toText(g.expr)).toBe('exp(-x^2)');
  });
  it('errors carry line numbers', () => {
    const ws = new Workspace(['script bad\n  a = 1;\n  b = [1 2] + [1 2 3];\nend']);
    expect(err(ws, 'bad')).toMatch(/line 2: sizes do not match/);
    const ws2 = new Workspace(['script bad2\n  a = (1 + ;\nend']);
    expect(err(ws2, ws2.statements()[0].id)).toMatch(/line 2/);
  });
});
describe('script functions across cells', () => {
  it('a function block takes handles and arrays when called from a script (Euler for y′ = y)', () => {
    const ws = new Workspace([
      'function y = euler(f, y0, h, n)\n  y = zeros(1, n + 1);\n  y(1) = y0;\n  for k = 1:n\n    y(k + 1) = y(k) + h * f((k - 1) * h, y(k));\n  end\nend',
      'script ode\n  y = euler(@(x, y) y, 1, 0.1, 10);\n  last = y(end);\nend',
    ]);
    const y = ws.node('y')?.value as any;
    // Hughes-Hallett §11.3: 1, 1.1, 1.21, … and y(1) ≈ 1.1^10
    expect(y.items.slice(0, 3).map((v: any) => +v.value.toFixed(10))).toEqual([1, 1.1, 1.21]);
    expect((ws.node('last')?.value as any).value).toBeCloseTo(1.1 ** 10, 12);
  });
});

describe('R blocks (webR)', () => {
  it('an R block is a line `R [name]` … `end`; `R = …` is still a region', async () => {
    const { parseBlock } = await import('../src/parser/blocks');
    expect(findBlocks('R sim\nx <- rnorm(10)\nfor (i in 1:3) { print(i) }\nend\ny = 2')).toEqual([{ from: 0, to: 52 }]);
    expect(findBlocks('R = x^2 + y^2 <= 1')).toEqual([]);
    expect(openBlocks('R sim\nx <- 1\n')).toBe(1);
    const b = parseBlock('R sim\nn <- 10\nx <- rnorm(n)\nf <- function(t) {\n  y <- t^2\n  y\n}\nm = mean(x)\nend');
    expect(b.blockKind).toBe('r');
    expect(b.name).toBe('sim');
    expect(b.writes).toEqual(['n', 'x', 'f', 'm']);
    expect(parseBlock('R\nX <- rpois(5, 2); Y <- rpois(5, 2)\nend').writes).toEqual(['X', 'Y']);
    expect(b.reads).toEqual(expect.arrayContaining(['rnorm', 'n', 'mean']));
  });
});