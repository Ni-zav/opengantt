import * as Y from "yjs";
import { normalizeProject, type CommentThread, type Dependency, type Project, type Task, type WorkCalendar } from "./model";

export const LOCAL_ORIGIN = Symbol("opengantt-local");
export const INITIAL_ORIGIN = Symbol("opengantt-initial");

export interface ProjectYTypes {
  meta: Y.Map<unknown>;
  tasks: Y.Map<Y.Map<unknown>>;
  dependencies: Y.Map<Y.Map<unknown>>;
  calendars: Y.Map<Y.Map<unknown>>;
  threads: Y.Map<Y.Map<unknown>>;
}

export function projectYTypes(doc: Y.Doc): ProjectYTypes {
  return {
    meta: doc.getMap("project"), tasks: doc.getMap("tasks"), dependencies: doc.getMap("dependencies"),
    calendars: doc.getMap("calendars"), threads: doc.getMap("commentThreads")
  };
}

const sameValue = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true;
  if (left && right && typeof left === "object" && typeof right === "object") return JSON.stringify(left) === JSON.stringify(right);
  return false;
};

const setValues = (target: Y.Map<unknown>, values: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) target.delete(key);
    else if (!sameValue(target.get(key), value)) target.set(key, value);
  }
};

function syncRecords<T extends { id: string }>(target: Y.Map<Y.Map<unknown>>, records: T[], write: (map: Y.Map<unknown>, value: T) => void) {
  const ids = new Set(records.map(record => record.id));
  for (const key of target.keys()) if (!ids.has(key)) target.delete(key);
  for (const record of records) {
    let map = target.get(record.id);
    if (!(map instanceof Y.Map)) { map = new Y.Map(); target.set(record.id, map); }
    write(map, record);
  }
}

function writeTask(map: Y.Map<unknown>, task: Task) {
  setValues(map, {
    id: task.id, parentId: task.parentId, order: task.order, name: task.name, type: task.type,
    schedulingMode: task.schedulingMode, start: task.start, duration: task.duration, progress: task.progress,
    calendarId: task.calendarId, constraintType: task.constraint.type, constraintDate: task.constraint.date
  });
}

function writeDependency(map: Y.Map<unknown>, dependency: Dependency) {
  setValues(map, { ...dependency });
}

function writeCalendar(map: Y.Map<unknown>, calendar: WorkCalendar) {
  setValues(map, { id: calendar.id, name: calendar.name, workingDays: calendar.workingDays });
  let exceptions = map.get("exceptions");
  if (!(exceptions instanceof Y.Map)) { exceptions = new Y.Map(); map.set("exceptions", exceptions); }
  const exceptionMap = exceptions as Y.Map<boolean>;
  for (const key of exceptionMap.keys()) if (!(key in calendar.exceptions)) exceptionMap.delete(key);
  for (const [date, working] of Object.entries(calendar.exceptions)) if (exceptionMap.get(date) !== working) exceptionMap.set(date, working);
}

function writeThread(map: Y.Map<unknown>, thread: CommentThread) {
  setValues(map, { id: thread.id, taskId: thread.taskId, resolved: thread.resolved });
  let comments = map.get("comments");
  if (!(comments instanceof Y.Array)) { comments = new Y.Array(); map.set("comments", comments); }
  const array = comments as Y.Array<unknown>;
  const existing = new Set(array.toArray().map(value => (value as { id?: string })?.id));
  const additions = thread.comments.filter(comment => !existing.has(comment.id));
  if (additions.length) array.push(additions);
}

export function applyProjectToY(doc: Y.Doc, project: Project, origin: unknown = LOCAL_ORIGIN) {
  const types = projectYTypes(doc);
  doc.transact(() => {
    setValues(types.meta, { id: project.id, name: project.name, defaultCalendarId: project.defaultCalendarId, updatedAt: project.updatedAt });
    syncRecords(types.tasks, project.tasks, writeTask);
    syncRecords(types.dependencies, project.dependencies, writeDependency);
    syncRecords(types.calendars, project.calendars, writeCalendar);
    syncRecords(types.threads, project.commentThreads, writeThread);
  }, origin);
}

const value = <T>(map: Y.Map<unknown>, key: string, fallback: T): T => (map.get(key) as T | undefined) ?? fallback;

export function projectFromY(doc: Y.Doc): Project {
  const { meta, tasks, dependencies, calendars, threads } = projectYTypes(doc);
  const taskValues = [...tasks.values()].map(map => ({
    id: value(map, "id", ""), parentId: value<string | null>(map, "parentId", null), order: value(map, "order", 0),
    name: value(map, "name", "Untitled task"), type: value(map, "type", "task"), schedulingMode: value(map, "schedulingMode", "auto"),
    start: value(map, "start", new Date().toISOString().slice(0, 10)), duration: value(map, "duration", 1), progress: value(map, "progress", 0),
    calendarId: value(map, "calendarId", "default"), constraint: { type: value(map, "constraintType", "asap"), date: map.get("constraintDate") as string | undefined }
  })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const dependencyValues = [...dependencies.values()].map(map => ({ id: value(map, "id", ""), from: value(map, "from", ""), to: value(map, "to", ""), type: value(map, "type", "FS"), lag: value(map, "lag", 0) })).sort((a, b) => a.id.localeCompare(b.id));
  const calendarValues = [...calendars.values()].map(map => ({
    id: value(map, "id", "default"), name: value(map, "name", "Calendar"), workingDays: value(map, "workingDays", [1, 2, 3, 4, 5]),
    exceptions: map.get("exceptions") instanceof Y.Map ? (map.get("exceptions") as Y.Map<boolean>).toJSON() : value(map, "exceptions", {})
  })).sort((a, b) => a.id.localeCompare(b.id));
  const threadValues = [...threads.values()].map(map => ({
    id: value(map, "id", ""), taskId: value(map, "taskId", ""), resolved: value(map, "resolved", false),
    comments: map.get("comments") instanceof Y.Array ? (map.get("comments") as Y.Array<unknown>).toArray() : []
  })).sort((a, b) => a.id.localeCompare(b.id));
  const taskIds = new Set(taskValues.map(task => task.id));
  return normalizeProject({
    id: value(meta, "id", ""), name: value(meta, "name", "Untitled project"),
    defaultCalendarId: value(meta, "defaultCalendarId", "default"), updatedAt: value(meta, "updatedAt", new Date().toISOString()),
    tasks: taskValues,
    dependencies: dependencyValues.filter(dependency => taskIds.has(dependency.from) && taskIds.has(dependency.to) && dependency.from !== dependency.to),
    calendars: calendarValues,
    commentThreads: threadValues.filter(thread => taskIds.has(thread.taskId))
  });
}

export function isEmptyProjectDoc(doc: Y.Doc) {
  const types = projectYTypes(doc);
  return types.meta.size === 0 && types.tasks.size === 0;
}
