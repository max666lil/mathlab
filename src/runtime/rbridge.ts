/**
 * Real R in the browser (webR — R compiled to WebAssembly, loaded on first use from webr.r-wasm.org).
 * R blocks in the worksheet run here: worksheet numbers / lists they mention are passed in, printed
 * output and plots come back, and the variables they assign become worksheet objects. Runs are queued
 * (one R session) and cached by code + inputs; listeners hear when a result arrives.
 */

export interface RResult {
  output: string[];
  /** plots as PNG data URLs */
  images: string[];
  /** top-level variables: numeric / logical / character vectors */
  vars: Record<string, { type: string; values: (number | string | boolean | null)[] }>;
  error?: string;
}

type WebRModule = {
  WebR: new (opts: unknown) => {
    init(): Promise<void>;
    Shelter: new () => Promise<{
      captureR(code: string, opts: unknown): Promise<{ output: { type: string; data: unknown }[]; images: ImageBitmap[] }>;
      purge(): Promise<void>;
    }>;
    evalR(code: string): Promise<{ toJs(): Promise<{ type: string; values?: unknown[] }> }>;
  };
  ChannelType: { PostMessage: number };
};

const URL_WEBR = 'https://webr.r-wasm.org/latest/webr.mjs';

let session: Promise<InstanceType<WebRModule['WebR']>> | null = null;
export let rStatus: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

function webR() {
  if (!session) {
    rStatus = 'loading';
    session = (async () => {
      const m = (await import(/* @vite-ignore */ URL_WEBR)) as WebRModule;
      const r = new m.WebR({ channelType: m.ChannelType.PostMessage });
      await r.init();
      rStatus = 'ready';
      return r;
    })().catch((e) => {
      rStatus = 'failed';
      session = null;
      throw e;
    });
  }
  return session;
}

const cache = new Map<string, RResult>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

export function onRResult(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function rLiteral(v: number | number[] | string): string {
  if (typeof v === 'string') return JSON.stringify(v);
  const f = (x: number) => (Number.isFinite(x) ? String(x) : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf');
  return Array.isArray(v) ? `c(${v.map(f).join(', ')})` : f(v);
}

function imageToDataUrl(img: ImageBitmap): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

/** The cached result for this code + inputs, or undefined while it runs (a run is started). */
export function rResult(code: string, inputs: Record<string, number | number[] | string>, outputs: string[]): RResult | undefined {
  const key = JSON.stringify([code, inputs, outputs]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!pending.has(key)) {
    pending.add(key);
    queue = queue.then(() => run(key, code, inputs, outputs)).catch(() => undefined);
  }
  return undefined;
}

async function run(key: string, code: string, inputs: Record<string, number | number[] | string>, outputs: string[]) {
  let res: RResult;
  try {
    const r = await webR();
    const pre = Object.entries(inputs).map(([k, v]) => `${k} <- ${rLiteral(v)}`).join('\n');
    const shelter = await new r.Shelter();
    try {
      const cap = await shelter.captureR(`${pre}\n${code}`, { withAutoprint: true, captureStreams: true, captureConditions: false, captureGraphics: { width: 560, height: 400 } });
      const output = cap.output.filter((o) => o.type === 'stdout' || o.type === 'stderr').map((o) => String(o.data));
      const images = typeof document !== 'undefined' ? cap.images.map(imageToDataUrl) : [];
      const vars: RResult['vars'] = {};
      for (const name of outputs) {
        try {
          const js = await (await r.evalR(`if (exists("${name}")) ${name} else NULL`)).toJs();
          if (js && Array.isArray(js.values)) vars[name] = { type: js.type, values: js.values as (number | string | boolean | null)[] };
        } catch {
          /* not a plain vector */
        }
      }
      res = { output, images, vars };
    } finally {
      await shelter.purge();
    }
  } catch (e) {
    res = { output: [], images: [], vars: {}, error: e instanceof Error ? e.message : String(e) };
  }
  cache.set(key, res);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  pending.delete(key);
  listeners.forEach((l) => l());
}

/** Identifiers in R code (for worksheet inputs) and top-level assignments (exported variables). */
export function rUsage(code: string): { reads: string[]; writes: string[] } {
  const stripped = code.replace(/#[^\n]*/g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const reads = [...new Set(stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];
  const writes: string[] = [];
  // statements start at the beginning of a line or after `;`, at bracket depth 0
  let depth = 0;
  let segment = '';
  const check = () => {
    const m = /^\s*([A-Za-z][A-Za-z0-9_.]*)\s*(<-|=(?!=))/.exec(segment);
    if (m && !writes.includes(m[1])) writes.push(m[1]);
  };
  for (const ch of stripped + '\n') {
    if (depth === 0 && (ch === '\n' || ch === ';')) {
      check();
      segment = '';
      continue;
    }
    if (ch === '{' || ch === '(') depth++;
    else if (ch === '}' || ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 || segment.length < 200) segment += ch;
  }
  return { reads, writes };
}