/// <reference lib="webworker" />
import { projectToXlsx, xlsxToProject } from "./xlsxWorkbook";

self.onmessage = async (event: MessageEvent<{ id: string; type: "export" | "import"; payload: any }>) => {
  try {
    const result = event.data.type === "export" ? await projectToXlsx(event.data.payload) : await xlsxToProject(event.data.payload);
    if (result instanceof ArrayBuffer) self.postMessage({ id: event.data.id, result }, [result]);
    else self.postMessage({ id: event.data.id, result });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "XLSX operation failed." });
  }
};
