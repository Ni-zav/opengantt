import { describe, expect, it } from "vitest";
import { sampleProject } from "./model";
import { previewSchedule } from "./schedulePreview";
import { schedule } from "./scheduler";

describe("schedule preview", () => {
  it("keeps scheduled rows mounted while applying task edits", () => {
    const project = sampleProject();
    const current = schedule(project);
    const next = structuredClone(project);
    next.tasks[0].name = "Edited immediately";
    next.tasks[0].duration = 20;

    const preview = previewSchedule(current, next)!;

    expect(preview.tasks).toHaveLength(next.tasks.length);
    expect(preview.tasks[0].name).toBe("Edited immediately");
    expect(preview.tasks[0].duration).toBe(20);
    expect(preview.tasks[0].end).toBe(current.tasks[0].end);
  });

  it("does not flash stored values over a computed summary", () => {
    const project = sampleProject();
    project.tasks[1].parentId = project.tasks[0].id;
    const current = schedule(project);
    const next = structuredClone(project);
    next.tasks[1].progress = 75;

    const preview = previewSchedule(current, next)!;

    expect(preview.tasks[0].start).toBe(current.tasks[0].start);
    expect(preview.tasks[0].duration).toBe(current.tasks[0].duration);
    expect(preview.tasks[0].progress).toBe(current.tasks[0].progress);
  });
});
