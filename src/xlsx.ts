import type { Project } from "./model";
import type { XlsxReport } from "./xlsxWorkbook";

function run<T>(type: "export" | "import", payload: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url), { type: "module" });
    const id = crypto.randomUUID();
    worker.onmessage = event => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || "XLSX worker failed.")); };
    worker.postMessage({ id, type, payload }, transfer);
  });
}

export async function exportXlsx(project: Project) {
  const buffer = await run<ArrayBuffer>("export", project);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
}

export async function importXlsx(file: File): Promise<XlsxReport> {
  if (file.size > 10 * 1024 * 1024) throw new Error("XLSX files are limited to 10 MB.");
  const buffer = await file.arrayBuffer();
  return run<XlsxReport>("import", buffer, [buffer]);
}
