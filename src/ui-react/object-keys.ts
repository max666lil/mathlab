import type { Workspace } from '../runtime/workspace';

/** Keys an object is known by in the scene (its name and its role). */
export function objectKeys(ws: Workspace, id: string): string[] {
  const role = ws.value(id)?.role;
  return role ? [id, `role:${role}`] : [id];
}