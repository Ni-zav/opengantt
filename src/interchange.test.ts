import { describe, expect, it } from "vitest";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import mspdiFixture from "./fixtures/core-project.xml?raw";
import { defaultCalendar, normalizeProject } from "./model";
import { exportMspdi, importCsv, importMspdi, inspectCsv, parseCsv } from "./interchange";

if (typeof DOMParser === "undefined") Object.assign(globalThis, { DOMParser: XmlDomParser });

describe("interchange", () => {
  it("parses RFC 4180 quoting and maps CSV rows", () => {
    const text = 'ID,Task,Start,Days,Progress\r\n1,"Research, scope",2026-06-19,2,50%\r\n2,"Say ""go""",2026-06-22,1,0';
    expect(parseCsv(text)[1][1]).toBe("Research, scope");
    const inspected = inspectCsv(text);
    const report = importCsv(text, inspected.mapping);
    expect(report.project.tasks).toHaveLength(2);
    expect(report.project.tasks[0]).toMatchObject({ name: "Research, scope", duration: 2, progress: 50 });
    expect(report.project.tasks[1].name).toBe('Say "go"');
  });

  it("rejects CSV input beyond the project task limit during parsing", () => {
    const text = ["Task", ...Array.from({ length: 10_001 }, (_, index) => `Task ${index + 1}`)].join("\n");
    expect(() => parseCsv(text)).toThrow("limited to 10,000 tasks");
  });

  it("keeps valid task colors and drops invalid imported colors", () => {
    const base = { id: "p", name: "Colors", updatedAt: "2026-06-20T00:00:00Z", calendars: [defaultCalendar()], defaultCalendarId: "default", dependencies: [] };
    const task = { id: "a", name: "A", order: 0, parentId: null, type: "task", schedulingMode: "auto", start: "2026-06-19", duration: 1, progress: 0, calendarId: "default", constraint: { type: "asap" } };
    expect(normalizeProject({ ...base, tasks: [{ ...task, outlineColor: "#123abc", taskColor: "#fedcba" }] }).tasks[0]).toMatchObject({ outlineColor: "#123abc", taskColor: "#fedcba" });
    expect(normalizeProject({ ...base, tasks: [{ ...task, outlineColor: "red" }] }).tasks[0].outlineColor).toBeUndefined();
  });

  it("exports the core MSPDI task and dependency fields", () => {
    const project = normalizeProject({
      id: "p", name: "A & B", updatedAt: "2026-06-20T00:00:00Z", calendars: [defaultCalendar()], defaultCalendarId: "default",
      tasks: [
        { id: "a", name: "Design <phase>", order: 0, parentId: null, type: "task", schedulingMode: "auto", start: "2026-06-19", duration: 2, progress: 50, calendarId: "default", constraint: { type: "asap" } },
        { id: "b", name: "Launch", order: 1, parentId: null, type: "milestone", schedulingMode: "manual", start: "2026-06-23", duration: 0, progress: 0, calendarId: "default", constraint: { type: "asap" } }
      ], dependencies: [{ id: "d", from: "a", to: "b", type: "FS", lag: 1 }]
    });
    const xml = exportMspdi(project);
    expect(xml).toContain("<Name>A &amp; B</Name>");
    expect(xml).toContain("Design &lt;phase&gt;");
    expect(xml).toContain("<PredecessorUID>1</PredecessorUID>");
    expect(xml).toContain("<LinkLag>4800</LinkLag>");
  });

  it("imports the golden MSPDI hierarchy, milestone, dependency, and warning", () => {
    const report = importMspdi(mspdiFixture);
    expect(report.project.name).toBe("Golden MSPDI plan");
    expect(report.project.tasks.map(task => ({ name: task.name, type: task.type, mode: task.schedulingMode, duration: task.duration }))).toEqual([
      { name: "Delivery", type: "summary", mode: "auto", duration: 3 },
      { name: "Build", type: "task", mode: "auto", duration: 2 },
      { name: "Launch", type: "milestone", mode: "manual", duration: 0 }
    ]);
    expect(report.project.tasks[1].parentId).toBe(report.project.tasks[0].id);
    expect(report.project.dependencies[0]).toMatchObject({ from: report.project.tasks[1].id, to: report.project.tasks[2].id, type: "FS", lag: 1 });
    expect(report.warnings).toContain("Resources and assignments are not imported in this release.");
  });
});
