import type { Project } from "./model";
import { schedule, type ScheduleResult } from "./scheduler";

export function previewSchedule(current: ScheduleResult | null, project: Project): ScheduleResult | null {
  // ponytail: exact previews stay cheap at this size; the worker handles larger plans.
  if (project.tasks.length <= 1_000) return schedule(project);
  if (!current) return null;
  const scheduled = new Map(current.tasks.map(task => [task.id, task]));
  const rollupIds = new Set(project.tasks.map(task => task.parentId).filter((id): id is string => Boolean(id)));
  return {
    ...current,
    tasks: project.tasks.map(task => {
      const previous = scheduled.get(task.id);
      if (!previous) return { ...task, end: task.start, slack: 0, critical: false, invalid: false };
      const preview = { ...previous, ...task };
      return task.type === "summary" || rollupIds.has(task.id)
        ? { ...preview, start: previous.start, duration: previous.duration, progress: previous.progress, end: previous.end }
        : preview;
    })
  };
}
