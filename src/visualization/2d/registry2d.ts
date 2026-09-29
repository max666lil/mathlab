/** Registry of 2D drawers keyed by visual type (plugins add their own). */
import type { SceneItem } from '../scene-model';
import type { SceneFrame } from '../sampling';
import type { Theme } from '../theme';
import type { Workspace } from '../../runtime/workspace';
import type { View2D } from './view2d';

/** A draggable handle registered while drawing. */
export interface Handle2D {
  x: number;
  y: number;
  /** hit radius in pixels */
  r: number;
  itemId: string;
  nodeId: string;
  cursor?: string;
  drag(world: [number, number], mods: { shift: boolean }): void;
  end?(): void;
}

export interface Draw2DArgs {
  ctx: CanvasRenderingContext2D;
  view: View2D;
  item: SceneItem;
  frame: SceneFrame;
  theme: Theme;
  ws: Workspace;
  selected: boolean;
  handles: Handle2D[];
  /** per-view cache for expensive layers */
  cache: Map<string, unknown>;
}

export interface Drawer2D {
  /** paint order: 0 backgrounds … 10 handles */
  layer: number;
  draw(a: Draw2DArgs): void;
}

const drawers = new Map<string, Drawer2D>();
export function registerDrawer2D(vtype: string, d: Drawer2D) {
  drawers.set(vtype, d);
}
export function getDrawer2D(vtype: string): Drawer2D | undefined {
  return drawers.get(vtype);
}
