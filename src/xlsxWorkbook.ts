import ExcelJS from "exceljs";
import { createTask, defaultCalendar, normalizeProject, uid, type CommentThread, type ConstraintType, type Dependency, type Project, type WorkCalendar } from "./model";

export interface XlsxReport { project: Project; warnings: string[]; importedTasks: number }

const text = (value: ExcelJS.CellValue): string => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return text(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    if ("richText" in value) return value.richText.map(item => item.text).join("");
  }
  return String(value);
};

const sheetRows = (sheet: ExcelJS.Worksheet) => {
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => headers.set(text(cell.value).trim().toLowerCase(), column));
  const rows: Array<Record<string, string>> = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row: Record<string, string> = {};
    for (const [header, column] of headers) row[header] = text(sheet.getRow(rowNumber).getCell(column).value).trim();
    if (Object.values(row).some(Boolean)) rows.push(row);
  }
  return rows;
};

const styleSheet = (sheet: ExcelJS.Worksheet, widths: number[]) => {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF185F46" } };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
};

export async function projectToXlsx(project: Project): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenGantt"; workbook.created = new Date();

  const metadata = workbook.addWorksheet("Metadata");
  metadata.addRows([["Field", "Value"], ["Format", "OpenGantt"], ["Version", 2], ["Project ID", project.id], ["Project Name", project.name], ["Updated At", project.updatedAt], ["Default Calendar ID", project.defaultCalendarId]]);
  styleSheet(metadata, [24, 42]);

  const tasks = workbook.addWorksheet("Tasks");
  tasks.addRow(["ID", "Parent ID", "Name", "Type", "Start", "Duration", "Progress", "Scheduling Mode", "Calendar ID", "Constraint", "Constraint Date"]);
  for (const task of [...project.tasks].sort((a, b) => a.order - b.order)) {
    const row = tasks.addRow([task.id, task.parentId ?? "", task.name, task.type, task.start, task.duration, task.progress, task.schedulingMode, task.calendarId, task.constraint.type, task.constraint.date ?? ""]);
    row.outlineLevel = Math.min(7, (() => { let level = 0, parent = task.parentId; while (parent && level < 7) { level++; parent = project.tasks.find(item => item.id === parent)?.parentId ?? null; } return level; })());
  }
  styleSheet(tasks, [38, 38, 34, 14, 14, 12, 12, 18, 24, 24, 16]);

  const dependencies = workbook.addWorksheet("Dependencies");
  dependencies.addRow(["ID", "From", "To", "Type", "Lag"]);
  project.dependencies.forEach(item => dependencies.addRow([item.id, item.from, item.to, item.type, item.lag]));
  styleSheet(dependencies, [38, 38, 38, 10, 10]);

  const calendars = workbook.addWorksheet("Calendars");
  calendars.addRow(["ID", "Name", "Working Days", "Exceptions JSON"]);
  project.calendars.forEach(item => calendars.addRow([item.id, item.name, item.workingDays.join(","), JSON.stringify(item.exceptions)]));
  styleSheet(calendars, [28, 24, 20, 48]);

  const comments = workbook.addWorksheet("Comments");
  comments.addRow(["Thread ID", "Task ID", "Resolved", "Comment ID", "Author ID", "Author", "Body", "Mentions", "Created At"]);
  for (const thread of project.commentThreads) for (const comment of thread.comments) comments.addRow([thread.id, thread.taskId, thread.resolved, comment.id, comment.authorId ?? "", comment.authorName, comment.body, comment.mentions.join(","), comment.createdAt]);
  styleSheet(comments, [38, 38, 12, 38, 38, 24, 48, 28, 26]);

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array((buffer as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number }).buffer, (buffer as unknown as { byteOffset: number }).byteOffset, (buffer as unknown as { byteLength: number }).byteLength);
  return bytes.slice().buffer;
}

export async function xlsxToProject(buffer: ArrayBuffer): Promise<XlsxReport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never, { ignoreNodes: ["dataValidations", "extLst", "picture"] });
  const taskSheet = workbook.getWorksheet("Tasks");
  if (!taskSheet) throw new Error("Workbook must contain a Tasks sheet.");
  const rows = sheetRows(taskSheet);
  if (rows.length > 10_000) throw new Error("Workbooks are limited to 10,000 tasks.");
  const warnings: string[] = [], idMap = new Map<string, string>(), pendingParents = new Map<string, string>();
  const tasks = rows.map((row, order) => {
    const sourceId = row.id || String(order + 1), task = createTask(order, /^\d{4}-\d{2}-\d{2}$/.test(row.start) ? row.start : new Date().toISOString().slice(0, 10), row.name || `Task ${order + 1}`);
    idMap.set(sourceId, task.id); if (row["parent id"]) pendingParents.set(task.id, row["parent id"]);
    if (row.type === "summary" || row.type === "milestone") task.type = row.type;
    task.duration = Math.max(0, Number.parseInt(row.duration || "1", 10) || 0);
    task.progress = Math.min(100, Math.max(0, Number.parseFloat(row.progress || "0") || 0));
    task.schedulingMode = row["scheduling mode"] === "manual" ? "manual" : "auto";
    task.calendarId = row["calendar id"] || "default";
    const constraints = ["asap", "start-no-earlier-than", "finish-no-later-than", "must-start-on", "must-finish-on"];
    task.constraint = { type: constraints.includes(row.constraint) ? row.constraint as ConstraintType : "asap", date: row["constraint date"] || undefined };
    return task;
  });
  for (const task of tasks) {
    const sourceParent = pendingParents.get(task.id);
    if (sourceParent) { task.parentId = idMap.get(sourceParent) ?? null; if (!task.parentId) warnings.push(`Parent '${sourceParent}' was not found for ${task.name}.`); }
  }

  const dependencyRows = workbook.getWorksheet("Dependencies") ? sheetRows(workbook.getWorksheet("Dependencies")!) : [];
  const dependencies: Dependency[] = dependencyRows.flatMap(row => {
    const from = idMap.get(row.from), to = idMap.get(row.to);
    if (!from || !to) { warnings.push(`Dependency '${row.id || "unknown"}' references a missing task.`); return []; }
    const type = row.type === "SS" || row.type === "FF" || row.type === "SF" ? row.type : "FS";
    return [{ id: uid(), from, to, type, lag: Number.parseInt(row.lag || "0", 10) || 0 }];
  });

  const calendarRows = workbook.getWorksheet("Calendars") ? sheetRows(workbook.getWorksheet("Calendars")!) : [];
  const calendars: WorkCalendar[] = calendarRows.map(row => {
    let exceptions = {};
    try { exceptions = JSON.parse(row["exceptions json"] || "{}"); } catch { warnings.push(`Calendar '${row.name}' has invalid exceptions JSON.`); }
    const workingDays = row["working days"].split(",").map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    return { id: row.id || uid(), name: row.name || "Calendar", workingDays: workingDays.length ? workingDays : [1, 2, 3, 4, 5], exceptions };
  });
  if (!calendars.length) calendars.push(defaultCalendar());
  const calendarIds = new Set(calendars.map(calendar => calendar.id));
  for (const task of tasks) if (!calendarIds.has(task.calendarId)) { warnings.push(`Calendar '${task.calendarId}' was not found for ${task.name}; using default.`); task.calendarId = calendars[0].id; }

  const commentRows = workbook.getWorksheet("Comments") ? sheetRows(workbook.getWorksheet("Comments")!) : [];
  const threadMap = new Map<string, CommentThread>();
  for (const row of commentRows) {
    const taskId = idMap.get(row["task id"]); if (!taskId) { warnings.push("A comment references a missing task."); continue; }
    const threadId = row["thread id"] || uid();
    const thread = threadMap.get(threadId) ?? { id: uid(), taskId, resolved: row.resolved.toLowerCase() === "true", comments: [] };
    thread.comments.push({ id: uid(), authorId: row["author id"] || null, authorName: row.author || "Unknown", body: row.body.slice(0, 10_000), mentions: row.mentions.split(",").map(value => value.trim()).filter(Boolean), createdAt: row["created at"] || new Date().toISOString() });
    threadMap.set(threadId, thread);
  }
  const metadata = workbook.getWorksheet("Metadata") ? sheetRows(workbook.getWorksheet("Metadata")!) : [];
  const metadataMap = new Map(metadata.map(row => [row.field.toLowerCase(), row.value]));
  const project = normalizeProject({ id: uid(), name: metadataMap.get("project name") || "Imported workbook", tasks, dependencies, calendars, defaultCalendarId: metadataMap.get("default calendar id") || calendars[0].id, commentThreads: [...threadMap.values()], updatedAt: new Date().toISOString() });
  return { project, warnings, importedTasks: tasks.length };
}
