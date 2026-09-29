/** React bindings to the framework-free workspace. React only observes; it never computes math. */
import { createContext, useContext, useEffect, useState } from 'react';
import type { Workspace, Topic } from '../runtime/workspace';

export const WorkspaceContext = createContext<Workspace | null>(null);

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