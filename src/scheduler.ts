import type { Dependency, Project, Task, WorkCalendar } from "./model";

const DAY = 86_400_000;
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const validDate = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export interface ScheduleDiagnostic {
  code: "dependency-cycle" | "hierarchy-cycle" | "constraint-conflict" | "dependency-conflict" | "non-working-start" | "summary-dependency";
  taskIds: string[];
  message: string;
}

export interface ScheduledTask extends Task {
  end: string;
  slack: number;
  critical: boolean;
  invalid: boolean;
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  diagnostics: ScheduleDiagnostic[];
  projectStart: string;
  projectEnd: string;
}

export function isWorkingDay(value: string, calendar: WorkCalendar): boolean {
  if (value in calendar.exceptions) return calendar.exceptions[value];
  return calendar.workingDays.includes(parse(value).getUTCDay());
}

export function shiftWorkdays(start: string, days: number, calendar: WorkCalendar): string {
  if (days === 0) return start;
  const date = parse(start);
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + direction);
    if (isWorkingDay(iso(date), calendar)) remaining--;
  }
  return iso(date);
}

export function nextWorkingDay(start: string, calendar: WorkCalendar, direction: 1 | -1 = 1): string {
  let value = start;
  while (!isWorkingDay(value, calendar)) value = iso(new Date(parse(value).getTime() + direction * DAY));
  return value;
}

export function workdayDistance(from: string, to: string, calendar: WorkCalendar): number {
  if (from === to) return 0;
  let cursor = parse(from);
  const end = parse(to);
  let count = 0;
  const direction = cursor < end ? 1 : -1;
  while ((direction > 0 && cursor < end) || (direction < 0 && cursor > end)) {
    cursor = new Date(cursor.getTime() + direction * DAY);
    if (isWorkingDay(iso(cursor), calendar)) count += direction;
  }
  return count;
}

function endFromStart(start: string, duration: number, calendar: WorkCalendar): string {
  return duration <= 1 ? start : shiftWorkdays(start, duration - 1, calendar);
}

function startFromEnd(end: string, duration: number, calendar: WorkCalendar): string {
  return duration <= 1 ? end : shiftWorkdays(end, -(duration - 1), calendar);
}

function maxDate(...dates: string[]): string { return dates.filter(Boolean).sort().at(-1) ?? ""; }
function minDate(...dates: string[]): string { return dates.filter(Boolean).sort()[0] ?? ""; }

function dependencyRequiredStart(dep: Dependency, predecessor: ScheduledTask, successor: Task, calendar: WorkCalendar): string {
  switch (dep.type) {
    case "SS": return shiftWorkdays(predecessor.start, dep.lag, calendar);
    case "FF": return startFromEnd(shiftWorkdays(predecessor.end, dep.lag, calendar), successor.duration, calendar);
    case "SF": return startFromEnd(shiftWorkdays(predecessor.start, dep.lag, calendar), successor.duration, calendar);
    default: return shiftWorkdays(predecessor.end, dep.lag + 1, calendar);
  }
}

function dependencySatisfied(dep: Dependency, predecessor: ScheduledTask, successor: ScheduledTask, calendar: WorkCalendar): boolean {
  return successor.start >= dependencyRequiredStart(dep, predecessor, successor, calendar);
}

export function schedule(project: Project): ScheduleResult {
  const tasks = project.tasks.map(task => ({ ...task, constraint: { ...task.constraint } }));
  const byId = new Map(tasks.map(task => [task.id, task]));
  const calendars = new Map(project.calendars.map(calendar => [calendar.id, calendar]));
  const defaultCalendar = calendars.get(project.defaultCalendarId) ?? project.calendars[0];
  const calendarFor = (task: Task) => calendars.get(task.calendarId) ?? defaultCalendar;
  const diagnostics: ScheduleDiagnostic[] = [];
  const children = new Map(tasks.map(task => [task.id, [] as string[]]));
  for (const task of tasks) if (task.parentId && children.has(task.parentId)) children.get(task.parentId)!.push(task.id);
  const rollupIds = new Set(tasks.filter(task => task.type === "summary" || children.get(task.id)!.length).map(task => task.id));
  const incoming = new Map(tasks.map(task => [task.id, [] as Dependency[]]));
  const outgoing = new Map(tasks.map(task => [task.id, [] as Dependency[]]));
  const indegree = new Map(tasks.map(task => [task.id, 0]));

  for (const dep of project.dependencies) {
    const from = byId.get(dep.from), to = byId.get(dep.to);
    if (!from || !to || dep.from === dep.to) continue;
    if (rollupIds.has(from.id) || rollupIds.has(to.id)) {
      diagnostics.push({ code: "summary-dependency", taskIds: [dep.from, dep.to], message: "Dependencies cannot connect hierarchy parents or summary tasks." });
      continue;
    }
    incoming.get(dep.to)!.push(dep);
    outgoing.get(dep.from)!.push(dep);
    indegree.set(dep.to, indegree.get(dep.to)! + 1);
  }

  const queue = tasks.filter(task => !rollupIds.has(task.id) && indegree.get(task.id) === 0).map(task => task.id);
  const ordered: string[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    ordered.push(id);
    for (const dep of outgoing.get(id)!) {
      indegree.set(dep.to, indegree.get(dep.to)! - 1);
      if (indegree.get(dep.to) === 0) queue.push(dep.to);
    }
  }
  const orderedSet = new Set(ordered);
  const cyclic = new Set(tasks.filter(task => !rollupIds.has(task.id) && !orderedSet.has(task.id)).map(task => task.id));
  if (cyclic.size) diagnostics.push({ code: "dependency-cycle", taskIds: [...cyclic], message: "Dependency cycle must be removed before these tasks can be scheduled." });

  const scheduled = new Map<string, ScheduledTask>();
  const calculate = (task: Task, useDependencies: boolean): ScheduledTask => {
    const calendar = calendarFor(task);
    const wasWorking = isWorkingDay(task.start, calendar);
    let start = task.start;
    const locked = task.schedulingMode === "manual" || task.constraint.type === "must-start-on" || task.constraint.type === "must-finish-on";
    if (!wasWorking) {
      diagnostics.push({ code: "non-working-start", taskIds: [task.id], message: `${task.name} starts on a non-working day.` });
      if (!locked) start = nextWorkingDay(start, calendar);
    }
    if (validDate(task.constraint.date)) {
      const date = task.constraint.date!;
      if (task.constraint.type === "start-no-earlier-than") start = maxDate(start, nextWorkingDay(date, calendar));
      if (task.constraint.type === "must-start-on") start = date;
      if (task.constraint.type === "must-finish-on") start = startFromEnd(date, task.duration, calendar);
    }
    const required = useDependencies ? incoming.get(task.id)!.map(dep => {
      const predecessor = scheduled.get(dep.from);
      return predecessor ? dependencyRequiredStart(dep, predecessor, task, calendar) : "";
    }).filter(Boolean) : [];
    const requiredStart = maxDate(...required);
    if (requiredStart && requiredStart > start) {
      if (locked) diagnostics.push({ code: "dependency-conflict", taskIds: [task.id], message: `${task.name} is locked before a predecessor permits it to start.` });
      else start = requiredStart;
    }
    const end = endFromStart(start, task.duration, calendar);
    if (task.constraint.type === "finish-no-later-than" && validDate(task.constraint.date) && end > task.constraint.date!) {
      diagnostics.push({ code: "constraint-conflict", taskIds: [task.id], message: `${task.name} finishes after its constraint date.` });
    }
    return { ...task, start, end, slack: 0, critical: false, invalid: cyclic.has(task.id) };
  };

  for (const id of ordered) scheduled.set(id, calculate(byId.get(id)!, true));
  for (const id of cyclic) scheduled.set(id, calculate(byId.get(id)!, false));

  for (const dep of project.dependencies) {
    const predecessor = scheduled.get(dep.from), successor = scheduled.get(dep.to);
    if (predecessor && successor && !dependencySatisfied(dep, predecessor, successor, calendarFor(successor))) {
      diagnostics.push({ code: "dependency-conflict", taskIds: [dep.from, dep.to], message: `${successor.name} violates its ${dep.type} dependency on ${predecessor.name}.` });
    }
  }

  const hierarchyState = new Map<string, 1 | 2>(), hierarchyStack: string[] = [], hierarchyStackIndex = new Map<string, number>(), hierarchyCyclic = new Set<string>();
  const visitParent = (id: string) => {
    if (hierarchyState.get(id) === 2) return;
    if (hierarchyState.get(id) === 1) {
      for (let index = hierarchyStackIndex.get(id) ?? 0; index < hierarchyStack.length; index++) hierarchyCyclic.add(hierarchyStack[index]);
      return;
    }
    hierarchyState.set(id, 1);
    hierarchyStackIndex.set(id, hierarchyStack.length);
    hierarchyStack.push(id);
    const parent = byId.get(id)?.parentId;
    if (parent && byId.has(parent)) visitParent(parent);
    hierarchyStack.pop();
    hierarchyStackIndex.delete(id);
    hierarchyState.set(id, 2);
  };
  tasks.forEach(task => visitParent(task.id));
  if (hierarchyCyclic.size) {
    for (const id of hierarchyCyclic) {
      const task = scheduled.get(id);
      if (task) task.invalid = true;
    }
    diagnostics.push({ code: "hierarchy-cycle", taskIds: [...hierarchyCyclic], message: "Task hierarchy contains a cycle." });
  }

  const projectEnd = [...scheduled.values()].filter(task => !task.invalid).map(task => task.end).sort().at(-1) ?? tasks[0]?.start ?? "";
  const latestStart = new Map<string, string>();
  for (const id of [...ordered].reverse()) {
    const task = scheduled.get(id)!;
    const calendar = calendarFor(task);
    const candidates: string[] = [];
    for (const dep of outgoing.get(id)!) {
      const successor = scheduled.get(dep.to)!;
      const successorLatestStart = latestStart.get(dep.to) ?? successor.start;
      const successorLatestEnd = endFromStart(successorLatestStart, successor.duration, calendarFor(successor));
      if (dep.type === "FS") candidates.push(startFromEnd(shiftWorkdays(successorLatestStart, -(dep.lag + 1), calendar), task.duration, calendar));
      if (dep.type === "SS") candidates.push(shiftWorkdays(successorLatestStart, -dep.lag, calendar));
      if (dep.type === "FF") candidates.push(startFromEnd(shiftWorkdays(successorLatestEnd, -dep.lag, calendar), task.duration, calendar));
      if (dep.type === "SF") candidates.push(shiftWorkdays(successorLatestEnd, -dep.lag, calendar));
    }
    let latest = candidates.length ? minDate(...candidates) : startFromEnd(projectEnd, task.duration, calendar);
    if (task.constraint.type === "finish-no-later-than" && validDate(task.constraint.date)) latest = minDate(latest, startFromEnd(task.constraint.date!, task.duration, calendar));
    latestStart.set(id, latest);
    task.slack = Math.max(0, workdayDistance(task.start, latest, calendar));
    task.critical = !task.invalid && task.slack === 0;
  }

  const summarize = (id: string, visiting = new Set<string>()): ScheduledTask | undefined => {
    if (visiting.has(id)) return undefined;
    const existing = scheduled.get(id);
    if (existing) return existing;
    const task = byId.get(id);
    if (!task) return undefined;
    visiting.add(id);
    const descendants = (children.get(id) ?? []).map(child => summarize(child, visiting)).filter((item): item is ScheduledTask => Boolean(item));
    visiting.delete(id);
    const start = descendants.map(child => child.start).sort()[0] ?? task.start;
    const end = descendants.map(child => child.end).sort().at(-1) ?? task.start;
    const weight = descendants.reduce((sum, child) => sum + Math.max(1, child.duration), 0);
    const progress = weight ? Math.round(descendants.reduce((sum, child) => sum + child.progress * Math.max(1, child.duration), 0) / weight) : task.progress;
    const result: ScheduledTask = { ...task, start, end, duration: Math.max(0, workdayDistance(start, end, calendarFor(task)) + 1), progress, slack: 0, critical: descendants.some(child => child.critical), invalid: hierarchyCyclic.has(id) };
    scheduled.set(id, result);
    return result;
  };
  rollupIds.forEach(id => summarize(id));

  const resultTasks = tasks.map(task => scheduled.get(task.id) ?? calculate(task, false));
  return {
    tasks: resultTasks,
    diagnostics,
    projectStart: resultTasks.map(task => task.start).sort()[0] ?? "",
    projectEnd: resultTasks.map(task => task.end).sort().at(-1) ?? ""
  };
}
