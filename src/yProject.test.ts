import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createTask, sampleProject } from "./model";
import { applyProjectToY, LOCAL_ORIGIN, projectFromY, projectYTypes } from "./yProject";

describe("Yjs project mapping", () => {
  it("merges concurrent edits to different task fields", () => {
    const first = new Y.Doc(), second = new Y.Doc();
    const project = sampleProject();
    applyProjectToY(first, project);
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const baseline = Y.encodeStateVector(first);
    const firstTask = project.tasks[0].id;
    projectYTypes(first).tasks.get(firstTask)!.set("name", "Concurrent rename");
    projectYTypes(second).tasks.get(firstTask)!.set("progress", 73);
    const firstUpdate = Y.encodeStateAsUpdate(first, baseline);
    const secondUpdate = Y.encodeStateAsUpdate(second, baseline);
    Y.applyUpdate(first, secondUpdate); Y.applyUpdate(second, firstUpdate);
    expect(projectFromY(first).tasks[0]).toMatchObject({ name: "Concurrent rename", progress: 73 });
    expect(projectFromY(second)).toEqual(projectFromY(first));
  });

  it("undoes only transactions tagged as local", () => {
    const doc = new Y.Doc(), project = sampleProject();
    applyProjectToY(doc, project);
    const taskMap = projectYTypes(doc).tasks.get(project.tasks[0].id)!;
    const undo = new Y.UndoManager(taskMap, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 });
    doc.transact(() => taskMap.set("name", "Local edit"), LOCAL_ORIGIN);
    doc.transact(() => taskMap.set("progress", 61), "remote-provider");
    undo.undo();
    expect(taskMap.get("name")).toBe(project.tasks[0].name);
    expect(taskMap.get("progress")).toBe(61);
  });

  it("does not capture a materialized remote snapshot as local undo", () => {
    const doc = new Y.Doc(), project = sampleProject();
    applyProjectToY(doc, project);
    const types = projectYTypes(doc), undo = new Y.UndoManager([types.meta, types.tasks, types.calendars], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    doc.transact(() => types.tasks.get(project.tasks[0].id)!.set("progress", 88), "remote-provider");
    applyProjectToY(doc, projectFromY(doc), LOCAL_ORIGIN);
    expect(undo.undoStack).toHaveLength(0);
    undo.undo();
    expect(types.tasks.get(project.tasks[0].id)!.get("progress")).toBe(88);
  });

  it("preserves concurrent comment additions", () => {
    const first = new Y.Doc(), second = new Y.Doc(), project = sampleProject();
    applyProjectToY(first, project); Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const baseline = Y.encodeStateVector(first), taskId = project.tasks[0].id;
    const withComment = (id: string, body: string) => ({ ...project, commentThreads: [{ id, taskId, resolved: false, comments: [{ id: `${id}-comment`, authorId: null, authorName: id, body, mentions: [], createdAt: "2026-06-20T00:00:00Z" }] }] });
    applyProjectToY(first, withComment("one", "First"));
    applyProjectToY(second, withComment("two", "Second"));
    const update1 = Y.encodeStateAsUpdate(first, baseline), update2 = Y.encodeStateAsUpdate(second, baseline);
    Y.applyUpdate(first, update2); Y.applyUpdate(second, update1);
    expect(projectFromY(first).commentThreads.map(thread => thread.id).sort()).toEqual(["one", "two"]);
    expect(projectFromY(second)).toEqual(projectFromY(first));
  });

  it("merges calendar exceptions edited on different dates", () => {
    const first = new Y.Doc(), second = new Y.Doc(), project = sampleProject();
    applyProjectToY(first, project); Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const baseline = Y.encodeStateVector(first);
    const firstProject = structuredClone(project), secondProject = structuredClone(project);
    firstProject.calendars[0].exceptions["2026-06-22"] = false;
    secondProject.calendars[0].exceptions["2026-06-23"] = false;
    applyProjectToY(first, firstProject); applyProjectToY(second, secondProject);
    const update1 = Y.encodeStateAsUpdate(first, baseline), update2 = Y.encodeStateAsUpdate(second, baseline);
    Y.applyUpdate(first, update2); Y.applyUpdate(second, update1);
    expect(projectFromY(first).calendars[0].exceptions).toEqual({ "2026-06-22": false, "2026-06-23": false });
  });

  it("encodes a 10,000-task project within the collaboration payload budget", () => {
    const project = sampleProject();
    project.tasks = Array.from({ length: 10_000 }, (_, index) => createTask(index, "2026-01-05", `Task ${index + 1}`));
    project.dependencies = [];
    const doc = new Y.Doc(), started = performance.now();
    applyProjectToY(doc, project);
    const update = Y.encodeStateAsUpdate(doc);
    expect(update.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(projectFromY(doc).tasks).toHaveLength(10_000);
  });
});
