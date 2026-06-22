export type TaskType = "task" | "milestone" | "summary";
export type SchedulingMode = "auto" | "manual";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType = "asap" | "start-no-earlier-than" | "finish-no-later-than" | "must-start-on" | "must-finish-on";

export interface WorkCalendar {
  id: string;
  name: string;
  workingDays: number[];
  exceptions: Record<string, boolean>;
}

export interface TaskConstraint {
  type: ConstraintType;
  date?: string;
}

export interface Task {
  id: string;
  parentId: string | null;
  order: number;
  name: string;
  type: TaskType;
  schedulingMode: SchedulingMode;
  start: string;
  duration: number;
  progress: number;
  outlineColor?: string;
  taskColor?: string;
  calendarId: string;
  constraint: TaskConstraint;
}

export interface Dependency {
  id: string;
  from: string;
  to: string;
  type: DependencyType;
  lag: number;
}

export interface TaskComment {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface CommentThread {
  id: string;
  taskId: string;
  resolved: boolean;
  comments: TaskComment[];
}

export interface Project {
  id: string;
  name: string;
  tasks: Task[];
  dependencies: Dependency[];
  calendars: WorkCalendar[];
  defaultCalendarId: string;
  commentThreads: CommentThread[];
  updatedAt: string;
}

export interface OpenGanttFile {
  format: "opengantt";
  version: 2;
  exportedAt: string;
  project: Project;
}

export const uid = () => crypto.randomUUID();
export const isoToday = () => new Date().toISOString().slice(0, 10);
export const DEFAULT_CALENDAR_ID = "default";

export const defaultCalendar = (): WorkCalendar => ({
  id: DEFAULT_CALENDAR_ID,
  name: "Standard week",
  workingDays: [1, 2, 3, 4, 5],
  exceptions: {}
});

export function createTask(order: number, start = isoToday(), name = "New task"): Task {
  return {
    id: uid(), parentId: null, order, name, type: "task", schedulingMode: "auto",
    start, duration: 1, progress: 0, calendarId: DEFAULT_CALENDAR_ID, constraint: { type: "asap" }
  };
}

export function sampleProject(): Project {
  const start = isoToday();
  const tasks = [
    createTask(0, start, "Define scope"),
    createTask(1, start, "Design"),
    createTask(2, start, "Build"),
    { ...createTask(3, start, "Launch"), type: "milestone" as const, duration: 0 }
  ];
  tasks[0].duration = 3; tasks[0].progress = 100;
  tasks[1].duration = 5; tasks[1].progress = 40;
  tasks[2].duration = 8; tasks[2].progress = 10;
  const dependencies = tasks.slice(1).map((task, index) => ({
    id: uid(), from: tasks[index].id, to: task.id, type: "FS" as const, lag: 0
  }));
  return {
    id: uid(), name: "My first plan", tasks, dependencies,
    calendars: [defaultCalendar()], defaultCalendarId: DEFAULT_CALENDAR_ID,
    commentThreads: [],
    updatedAt: new Date().toISOString()
  };
}

export function normalizeProject(value: unknown): Project {
  if (!value || typeof value !== "object") throw new Error("Project must be an object.");
  const raw = value as Partial<Project> & { tasks?: Array<Partial<Task>>; dependencies?: Array<Partial<Dependency>> };
  const calendars = Array.isArray(raw.calendars) && raw.calendars.length ? raw.calendars : [defaultCalendar()];
  const defaultCalendarId = typeof raw.defaultCalendarId === "string" && calendars.some(c => c.id === raw.defaultCalendarId)
    ? raw.defaultCalendarId : calendars[0].id;
  const project: Project = {
    id: typeof raw.id === "string" ? raw.id : uid(),
    name: typeof raw.name === "string" ? raw.name : "Untitled project",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    calendars: calendars.map(calendar => {
      const workingDays = Array.isArray(calendar.workingDays) ? calendar.workingDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [];
      return {
        id: String(calendar.id), name: String(calendar.name || "Calendar"),
        workingDays: workingDays.length ? workingDays : [1, 2, 3, 4, 5],
        exceptions: calendar.exceptions && typeof calendar.exceptions === "object" ? calendar.exceptions : {}
      };
    }),
    defaultCalendarId,
    commentThreads: Array.isArray(raw.commentThreads) ? raw.commentThreads.map(thread => ({
      id: String(thread.id || uid()), taskId: String(thread.taskId || ""), resolved: Boolean(thread.resolved),
      comments: Array.isArray(thread.comments) ? thread.comments.map(comment => ({
        id: String(comment.id || uid()), authorId: typeof comment.authorId === "string" ? comment.authorId : null,
        authorName: String(comment.authorName || "Unknown"), body: String(comment.body || "").slice(0, 10_000),
        mentions: Array.isArray(comment.mentions) ? comment.mentions.map(String) : [],
        createdAt: typeof comment.createdAt === "string" ? comment.createdAt : new Date().toISOString()
      })) : []
    })) : [],
    tasks: (raw.tasks ?? []).map((task, index) => ({
      id: typeof task.id === "string" ? task.id : uid(),
      parentId: typeof task.parentId === "string" ? task.parentId : null,
      order: Number.isFinite(task.order) ? Number(task.order) : index,
      name: typeof task.name === "string" ? task.name : "Untitled task",
      type: task.type === "milestone" || task.type === "summary" ? task.type : "task",
      schedulingMode: task.schedulingMode === "manual" ? "manual" : "auto",
      start: typeof task.start === "string" ? task.start : isoToday(),
      duration: Number.isInteger(task.duration) ? Number(task.duration) : 1,
      progress: Number.isFinite(task.progress) ? Math.min(100, Math.max(0, Number(task.progress))) : 0,
      outlineColor: typeof task.outlineColor === "string" && /^#[0-9a-f]{6}$/i.test(task.outlineColor) ? task.outlineColor : undefined,
      taskColor: typeof task.taskColor === "string" && /^#[0-9a-f]{6}$/i.test(task.taskColor) ? task.taskColor : undefined,
      calendarId: typeof task.calendarId === "string" && calendars.some(c => c.id === task.calendarId) ? task.calendarId : defaultCalendarId,
      constraint: task.constraint && typeof task.constraint === "object" ? task.constraint : { type: "asap" }
    })),
    dependencies: (raw.dependencies ?? []).map(dep => ({
      id: typeof dep.id === "string" ? dep.id : uid(),
      from: String(dep.from ?? ""), to: String(dep.to ?? ""),
      type: dep.type === "SS" || dep.type === "FF" || dep.type === "SF" ? dep.type : "FS",
      lag: Number.isInteger(dep.lag) ? Number(dep.lag) : 0
    }))
  };
  assertProject(project);
  return project;
}

export function assertProject(value: unknown): asserts value is Project {
  if (!value || typeof value !== "object") throw new Error("Project must be an object.");
  const p = value as Partial<Project>;
  if (typeof p.id !== "string" || typeof p.name !== "string" || !Array.isArray(p.tasks) || !Array.isArray(p.dependencies) || !Array.isArray(p.calendars)) {
    throw new Error("Project is missing required fields.");
  }
  if (p.tasks.length > 10_000) throw new Error("Projects are limited to 10,000 tasks.");
  if (p.dependencies.length > 50_000) throw new Error("Projects are limited to 50,000 dependencies.");
  const ids = new Set<string>();
  for (const task of p.tasks) {
    if (!task || typeof task.id !== "string" || typeof task.name !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.start)) throw new Error("A task has invalid fields.");
    if (ids.has(task.id)) throw new Error("Task IDs must be unique.");
    if (!Number.isInteger(task.duration) || task.duration < 0 || task.duration > 100_000) throw new Error("Task duration is invalid.");
    if ((task.outlineColor && !/^#[0-9a-f]{6}$/i.test(task.outlineColor)) || (task.taskColor && !/^#[0-9a-f]{6}$/i.test(task.taskColor))) throw new Error("Task color is invalid.");
    if (task.parentId === task.id) throw new Error("A task cannot be its own parent.");
    ids.add(task.id);
  }
  for (const dep of p.dependencies) {
    if (!ids.has(dep.from) || !ids.has(dep.to) || dep.from === dep.to) throw new Error("A dependency references an invalid task.");
    if (!Number.isInteger(dep.lag) || Math.abs(dep.lag) > 100_000) throw new Error("Dependency lag is invalid.");
  }
  if (p.commentThreads && (!Array.isArray(p.commentThreads) || p.commentThreads.some(thread => !ids.has(thread.taskId)))) throw new Error("A comment thread references an invalid task.");
}
