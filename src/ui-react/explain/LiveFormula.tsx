/**
 * A formula whose terms are live handles on the scene: hovering a term emphasises the objects it
 * refers to in every view; terms light up when those objects are selected or hovered elsewhere.
 * Terms are marked in LaTeX with \htmlClass{mlp-<i>}{…}.
 */
import { useEffect, useMemo, useRef } from 'react';
import katex from 'katex';
import { useEmphasis } from '../hooks';

export interface FormulaPart {
  keys: string[];
  /** hide unrelated objects instead of dimming them */
  isolate?: boolean;
}

export const part = (i: number, tex: string) => `\\htmlClass{mlp mlp-${i}}{${tex}}`;

export function LiveFormula({ tex, parts, display = true }: { tex: string; parts: FormulaPart[]; display?: boolean }) {
  const emph = useEmphasis();
  const ref = useRef<HTMLSpanElement>(null);
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: (ctx) => ctx.command === '\\htmlClass',
      }),
    [tex, display],
  );
  // light up terms whose objects are active
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('.mlp').forEach((el) => {
      const i = Number([...el.classList].find((c) => /^mlp-\d+$/.test(c))?.slice(4));
      el.classList.toggle('on', !!parts[i] && emph.active(parts[i].keys));
    });
  });
  const locate = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.('.mlp') as HTMLElement | null;
    if (!el) return null;
    const c = [...el.classList].find((x) => /^mlp-\d+$/.test(x));
    return c ? Number(c.slice(4)) : null;
  };
  return (
    <span
      ref={ref}
      className="live-formula"
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseOver={(e) => {
        const i = locate(e.target);
        if (i !== null && parts[i]) emph.enter(parts[i].keys, parts[i].isolate);
        else emph.leave();
      }}
      onMouseLeave={emph.leave}
    />
  );
}