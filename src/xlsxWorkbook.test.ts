import { describe, expect, it } from "vitest";
import fixture from "./fixtures/core-project.json";
import { normalizeProject } from "./model";
import { projectToXlsx, xlsxToProject } from "./xlsxWorkbook";

describe("XLSX interchange", () => {
  it("round-trips the golden project through a real OOXML workbook", async () => {
    const project = normalizeProject(fixture);
    const buffer = await projectToXlsx(project);
    expect([...new Uint8Array(buffer).slice(0, 2)]).toEqual([0x50, 0x4b]);
    const report = await xlsxToProject(buffer);
    expect(report.warnings).toEqual([]);
    expect(report.project.tasks.map(task => ({ name: task.name, type: task.type, start: task.start, duration: task.duration, progress: task.progress, constraint: task.constraint }))).toEqual(
      project.tasks.map(task => ({ name: task.name, type: task.type, start: task.start, duration: task.duration, progress: task.progress, constraint: task.constraint }))
    );
    expect(report.project.dependencies[0]).toMatchObject({ type: "FS", lag: 1 });
    expect(report.project.calendars[0].exceptions).toEqual({ "2026-06-22": false });
    expect(report.project.commentThreads[0].comments[0]).toMatchObject({ body: "Review with @owner", mentions: ["owner"] });
  });
});
