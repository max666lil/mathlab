import { memo } from 'react';
import katex from 'katex';

const cache = new Map<string, string>();

function render(tex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${tex}`;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
    } catch {
      html = tex;
    }
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

/** KaTeX-rendered LaTeX. */
export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: render(tex, display) }} />;
});