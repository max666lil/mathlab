/** React bindings to the framework-free workspace. React only observes; it never computes math. */
import { createContext, useContext, useEffect, useState } from 'react';
import type { Workspace, Topic } from '../runtime/workspace';
import type { Presentation } from '../visualization/presentation';
import type { AnalysisService } from '../runtime/analysis';

export const WorkspaceContext = createContext<Workspace | null>(null);
export const PresentationContext = createContext<Presentation | null>(null);
export const AnalysisContext = createContext<AnalysisService | null>(null);

/** The analysis service; re-renders when the analysis or the workspace values change. */
export function useAnalysis(): AnalysisService {
  const a = useContext(AnalysisContext);
  if (!a) throw new Error('Analysis missing');
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    return a.on(() => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    });
  }, [a]);
  useTopics('values', 'doc', 'view');
  return a;
}

export function usePres(): Presentation {
  const p = useContext(PresentationContext);
  if (!p) throw new Error('Presentation missing');
  return p;
}

/** Emphasis helpers for UI elements that represent mathematical objects. */
export function useEmphasis() {
  const ws = useWs();
  const pres = usePres();
  const [, setKey] = useState('');
  useEffect(
    () =>
      pres.on(() => {
        const k = [...pres.activeKeys()].join('|');
        setKey((prev) => (prev === k ? prev : k));
      }),
    [pres],
  );
  return {
    active: (keys: string[]) => pres.isActive(keys),
    enter: (keys: string[], isolate = false) => ws.setEmphasis({ keys, isolate, source: 'ui' }),
    leave: () => ws.emphasis?.source === 'ui' && ws.setEmphasis(null),
  };
}

export function useWs(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('Workspace missing');
  return ws;
}

/**
 * Re-render when any of the topics change, at most once per animation frame (dragging emits
 * far more often than React needs to paint).
 */
export function useTopics(...topics: Topic[]): number {
  const ws = useWs();
  const [tick, setTick] = useState(0);
  const key = topics.join(',');
  useEffect(() => {
    let raf = 0;
    const bump = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    };
    const unsubs = topics.map((t) => ws.on(t, bump));
    return () => {
      cancelAnimationFrame(raf);
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, key]);
  return tick;
}