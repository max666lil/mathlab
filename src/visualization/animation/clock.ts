/** Animation clock: drives workspace animations (sliders, `animate` statements) every frame. */
import type { Workspace } from '../../runtime/workspace';

export function startClock(ws: Workspace): () => void {
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (ws.playing.size) ws.tick(now);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}