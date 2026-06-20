import { createTask, defaultCalendar, normalizeProject, uid, type DependencyType, type Project, type Task } from "./model";

export interface CsvMapping {
  name: string;
  start?: string;
  duration?: string;
  progress?: string;
  id?: string;
  parentId?: string;
}

export interface ImportReport {
  project: Project;
  warnings: string[];
  importedTasks: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      if (rows.length > 10_001) throw new Error("CSV files are limited to 10,000 tasks.");
    }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (field || row.length) {
    row.push(field); rows.push(row);
    if (rows.length > 10_001) throw new Error("CSV files are limited to 10,000 tasks.");
  }
  return rows.filter(item => item.some(value => value.trim()));
}

export function inspectCsv(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one task.");
  const headers = rows[0].map(value => value.trim());
  const find = (...names: string[]) => headers.find(header => names.includes(header.toLowerCase()));
  const mapping: CsvMapping = {
    name: find("name", "task", "task name", "title") ?? headers[0],
    start: find("start", "start date"), duration: find("duration", "days"),
    progress: find("progress", "% complete", "percent complete"), id: find("id", "uid"), parentId: find("parent", "parent id")
  };
  return { headers, preview: rows.slice(1, 6), mapping };
}

function dateValue(value: string, fallback: string, warnings: string[], row: number) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  if (trimmed) warnings.push(`Row ${row}: invalid start date '${trimmed}', using ${fallback}.`);
  return fallback;
}

export function importCsv(text: string, mapping: CsvMapping, projectName = "Imported spreadsheet"): ImportReport {
  const rows = parseCsv(text), headers = rows.shift() ?? [];
  const column = (name?: string) => name ? headers.indexOf(name) : -1;
  const nameIndex = column(mapping.name);
  if (nameIndex < 0) throw new Error("Choose a task-name column.");
  const warnings: string[] = [], today = new Date().toISOString().slice(0, 10);
  const sourceIds = new Map<string, string>();
  const tasks = rows.map((row, index) => {
    const sourceId = column(mapping.id) >= 0 ? row[column(mapping.id)]?.trim() : "";
    const task = createTask(index, dateValue(row[column(mapping.start)] ?? "", today, warnings, index + 2), row[nameIndex]?.trim() || `Task ${index + 1}`);
    if (sourceId) sourceIds.set(sourceId, task.id);
    const duration = Number.parseInt(row[column(mapping.duration)] ?? "1", 10);
    const progress = Number.parseFloat((row[column(mapping.progress)] ?? "0").replace("%", ""));
    task.duration = Number.isFinite(duration) ? Math.max(0, duration) : 1;
    task.progress = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
    return { task, parentSource: column(mapping.parentId) >= 0 ? row[column(mapping.parentId)]?.trim() : "" };
  });
  for (const item of tasks) if (item.parentSource) {
    item.task.parentId = sourceIds.get(item.parentSource) ?? null;
    if (!item.task.parentId) warnings.push(`Parent '${item.parentSource}' was not found for ${item.task.name}.`);
  }
  const project = normalizeProject({ id: uid(), name: projectName, tasks: tasks.map(item => item.task), dependencies: [], calendars: [defaultCalendar()], defaultCalendarId: "default", updatedAt: new Date().toISOString() });
  return { project, warnings, importedTasks: project.tasks.length };
}

const xmlEscape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const durationDays = (duration: string) => {
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return 1;
  return Math.max(0, Number(match[1] ?? 0) + Math.ceil((Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) / 480));
};

export function importMspdi(text: string): ImportReport {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("Microsoft Project XML is malformed.");
  const taskNodes = [...document.getElementsByTagName("Task")];
  const warnings: string[] = [], ids = new Map<string, string>(), outline: Array<string | undefined> = [];
  const tasks: Task[] = taskNodes.map((node, index) => {
    const get = (name: string) => node.getElementsByTagName(name)[0]?.textContent?.trim() ?? "";
    const sourceId = get("UID") || String(index + 1), level = Math.max(1, Number(get("OutlineLevel") || 1));
    const task = createTask(index, (get("Start") || new Date().toISOString()).slice(0, 10), get("Name") || `Task ${index + 1}`);
    task.duration = get("Milestone") === "1" ? 0 : durationDays(get("Duration"));
    task.type = get("Milestone") === "1" ? "milestone" : get("Summary") === "1" ? "summary" : "task";
    task.schedulingMode = get("Manual") === "1" ? "manual" : "auto";
    task.progress = Math.min(100, Math.max(0, Number(get("PercentComplete") || 0)));
    task.parentId = level > 1 ? outline[level - 1] ?? null : null;
    outline[level] = task.id; outline.length = level + 1;
    ids.set(sourceId, task.id);
    return task;
  });
  const dependencies = taskNodes.flatMap((node, taskIndex) => [...node.getElementsByTagName("PredecessorLink")].flatMap(link => {
    const get = (name: string) => link.getElementsByTagName(name)[0]?.textContent?.trim() ?? "";
    const from = ids.get(get("PredecessorUID")), to = tasks[taskIndex]?.id;
    if (!from || !to) { warnings.push(`A predecessor link on task ${taskIndex + 1} references a missing task.`); return []; }
    const types: DependencyType[] = ["FF", "FS", "SF", "SS"];
    return [{ id: uid(), from, to, type: types[Number(get("Type") || 1)] ?? "FS", lag: Math.round(Number(get("LinkLag") || 0) / 4800) }];
  }));
  const name = document.getElementsByTagName("Name")[0]?.textContent?.trim() || "Imported Microsoft Project";
  const project = normalizeProject({ id: uid(), name, tasks, dependencies, calendars: [defaultCalendar()], defaultCalendarId: "default", updatedAt: new Date().toISOString() });
  if (document.getElementsByTagName("Resource").length) warnings.push("Resources and assignments are not imported in this release.");
  return { project, warnings, importedTasks: tasks.length };
}

export function exportMspdi(project: Project): string {
  const uidById = new Map(project.tasks.map((task, index) => [task.id, index + 1]));
  const typeCode: Record<DependencyType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
  const outlineLevel = (task: Task) => {
    let level = 1, parent = task.parentId, guard = 0;
    while (parent && guard++ < 20) { level++; parent = project.tasks.find(item => item.id === parent)?.parentId ?? null; }
    return level;
  };
  const tasks = project.tasks.map(task => {
    const predecessors = project.dependencies.filter(dep => dep.to === task.id).map(dep => `<PredecessorLink><PredecessorUID>${uidById.get(dep.from)}</PredecessorUID><Type>${typeCode[dep.type]}</Type><LinkLag>${dep.lag * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("");
    return `<Task><UID>${uidById.get(task.id)}</UID><ID>${uidById.get(task.id)}</ID><Name>${xmlEscape(task.name)}</Name><OutlineLevel>${outlineLevel(task)}</OutlineLevel><Start>${task.start}T08:00:00</Start><Duration>PT${Math.max(0, task.duration) * 8}H0M0S</Duration><Milestone>${task.type === "milestone" ? 1 : 0}</Milestone><Summary>${task.type === "summary" ? 1 : 0}</Summary><Manual>${task.schedulingMode === "manual" ? 1 : 0}</Manual><PercentComplete>${task.progress}</PercentComplete>${predecessors}</Task>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>${xmlEscape(project.name)}</Name><Tasks>${tasks}</Tasks></Project>`;
}
