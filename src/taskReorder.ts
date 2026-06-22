import type { Task } from "./model";

export type DropPlacement = "before" | "after" | "inside";

export function moveTasks(tasks: Task[], draggedId: string, targetId: string, placement: DropPlacement): Task[] {
  const ordered = [...tasks].sort((a, b) => a.order - b.order);
  const byId = new Map(ordered.map(task => [task.id, task]));
  if (!byId.has(draggedId) || !byId.has(targetId) || draggedId === targetId) return tasks;
  const children = new Map(ordered.map(task => [task.id, [] as string[]]));
  for (const task of ordered) if (task.parentId && children.has(task.parentId)) children.get(task.parentId)!.push(task.id);
  const subtree = (root: string) => {
    const ids = new Set<string>(), pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      if (ids.has(id)) continue;
      ids.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    return ids;
  };
  const movingIds = subtree(draggedId);
  if (movingIds.has(targetId)) return tasks;
  const moving = ordered.filter(task => movingIds.has(task.id));
  const remaining = ordered.filter(task => !movingIds.has(task.id));
  const target = byId.get(targetId)!;
  const targetIndex = remaining.findIndex(task => task.id === targetId);
  const targetSubtree = subtree(targetId);
  const afterTarget = remaining.reduce((last, task, index) => targetSubtree.has(task.id) ? index + 1 : last, targetIndex + 1);
  const insertAt = placement === "before" ? targetIndex : afterTarget;
  const parentId = placement === "inside" ? targetId : target.parentId;
  const moved = moving.map(task => task.id === draggedId ? { ...task, parentId } : task);
  remaining.splice(insertAt, 0, ...moved);
  return remaining.map((task, order) => ({ ...task, order }));
}
