/** Animation clock: drives workspace animations and presentation transitions every frame. */
import type { Workspace } from '../../runtime/workspace';
import type { Presentation } from '../presentation';

export function startClock(ws: Workspace, pres?: Presentation): () => void {
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (ws.playing.size) ws.tick(now);
    pres?.tick(now);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}