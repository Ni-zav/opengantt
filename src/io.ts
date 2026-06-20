import { normalizeProject, type OpenGanttFile, type Project, uid } from "./model";
import { exportMspdi } from "./interchange";

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportOpenGantt(project: Project) {
  const file: OpenGanttFile = { format: "opengantt", version: 2, exportedAt: new Date().toISOString(), project };
  download(`${project.name}.opengantt`, "application/vnd.opengantt+json", JSON.stringify(file, null, 2));
}

const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function exportCsv(project: Project) {
  const rows = [["ID", "Name", "Start", "Duration", "Progress"], ...project.tasks.map(t => [t.id, t.name, t.start, t.duration, t.progress])];
  download(`${project.name}.csv`, "text/csv;charset=utf-8", rows.map(row => row.map(csvCell).join(",")).join("\r\n"));
}

export function exportProjectXml(project: Project) {
  download(`${project.name}.xml`, "application/xml;charset=utf-8", exportMspdi(project));
}

export function importOpenGantt(text: string): Project {
  const file = JSON.parse(text) as { format?: string; version?: number; project?: unknown };
  if (file.format !== "opengantt" || (file.version !== 1 && file.version !== 2)) throw new Error("Unsupported OpenGantt file version.");
  const project = normalizeProject(file.project);
  return { ...project, id: uid(), updatedAt: new Date().toISOString() };
}
