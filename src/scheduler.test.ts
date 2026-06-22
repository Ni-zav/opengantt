import { describe, expect, it } from "vitest";
import { createTask, defaultCalendar, type Dependency, type DependencyType, type Project, type Task } from "./model";
import { schedule, shiftWorkdays } from "./scheduler";

const task = (id: string, start = "2026-06-19", duration = 1): Task => ({ ...createTask(0, start, id), id, duration });
const dep = (from: string, to: string, type: DependencyType = "FS", lag = 0): Dependency => ({ id: `${from}-${to}-${type}`, from, to, type, lag });
const project = (tasks: Task[], dependencies: Dependency[] = []): Project => ({
  id: "project", name: "Test", tasks: tasks.map((item, order) => ({ ...item, order })), dependencies,
  calendars: [defaultCalendar()], defaultCalendarId: "default", commentThreads: [], updatedAt: "2026-06-20T00:00:00Z"
});

describe("scheduler", () => {
  it("uses working days, calendar exceptions, and finish-to-start semantics", () => {
    const calendar = defaultCalendar();
    calendar.exceptions["2026-06-22"] = false;
    expect(shiftWorkdays("2026-06-19", 1, calendar)).toBe("2026-06-23");
    expect(shiftWorkdays("2026-06-23", -1, calendar)).toBe("2026-06-19");
    const input = project([task("a", "2026-06-19", 1), task("b")], [dep("a", "b")]);
    input.calendars = [calendar];
    expect(schedule(input).tasks[1].start).toBe("2026-06-23");
  });

  it("supports SS, FF, and lag scheduling", () => {
    const ss = schedule(project([task("a"), task("b")], [dep("a", "b", "SS", 1)])).tasks[1];
    expect(ss.start).toBe("2026-06-22");
    const ff = schedule(project([task("a", "2026-06-19", 3), task("b", "2026-06-19", 2)], [dep("a", "b", "FF")])).tasks[1];
    expect(ff.start).toBe("2026-06-22");
    expect(ff.end).toBe("2026-06-23");
  });

  it("supports SF and negative FS lag deterministically", () => {
    const sf = schedule(project([task("a", "2026-06-19", 1), task("b", "2026-06-15", 2)], [dep("a", "b", "SF")])).tasks[1];
    expect(sf.start).toBe("2026-06-18");
    expect(sf.end).toBe("2026-06-19");
    const overlap = schedule(project([task("a", "2026-06-19", 3), task("b", "2026-06-19")], [dep("a", "b", "FS", -1)])).tasks[1];
    expect(overlap.start).toBe("2026-06-23");
  });

  it("reports cycles and locked-task dependency conflicts without deleting data", () => {
    const cyclic = schedule(project([task("a"), task("b")], [dep("a", "b"), dep("b", "a")]));
    expect(cyclic.tasks.every(item => item.invalid)).toBe(true);
    expect(cyclic.diagnostics.some(item => item.code === "dependency-cycle")).toBe(true);
    const manual = task("manual", "2026-06-19"); manual.schedulingMode = "manual";
    const conflict = schedule(project([task("first", "2026-06-22", 2), manual], [dep("first", "manual")]));
    expect(conflict.tasks[1].start).toBe("2026-06-19");
    expect(conflict.diagnostics.some(item => item.code === "dependency-conflict")).toBe(true);
  });

  it("derives summary dates and weighted progress", () => {
    const summary = task("summary"); summary.type = "summary";
    const first = task("first", "2026-06-19", 1); first.parentId = summary.id; first.progress = 100;
    const second = task("second", "2026-06-22", 3); second.parentId = summary.id;
    const result = schedule(project([summary, first, second])).tasks[0];
    expect(result.start).toBe("2026-06-19");
    expect(result.end).toBe("2026-06-24");
    expect(result.progress).toBe(25);
  });

  it("recursively rolls child tasks into every hierarchy parent", () => {
    const root = task("root"), group = task("group"), nestedDone = task("nested-done", "2026-06-19", 1);
    const nestedTodo = task("nested-todo", "2026-06-22", 3), directDone = task("direct-done", "2026-06-25", 2);
    group.parentId = root.id; nestedDone.parentId = group.id; nestedTodo.parentId = group.id; directDone.parentId = root.id;
    nestedDone.progress = 100; directDone.progress = 100;

    const result = new Map(schedule(project([root, group, nestedDone, nestedTodo, directDone])).tasks.map(item => [item.id, item]));

    expect(result.get("group")).toMatchObject({ start: "2026-06-19", end: "2026-06-24", duration: 4, progress: 25 });
    expect(result.get("root")).toMatchObject({ start: "2026-06-19", end: "2026-06-26", duration: 6, progress: 50 });
  });

  it("marks every task in a hierarchy cycle invalid", () => {
    const first = task("first"), second = task("second"), third = task("third");
    first.parentId = third.id; second.parentId = first.id; third.parentId = second.id;
    const result = schedule(project([first, second, third]));
    expect(result.tasks.every(item => item.invalid)).toBe(true);
    expect(result.diagnostics.find(item => item.code === "hierarchy-cycle")?.taskIds.sort()).toEqual(["first", "second", "third"]);
  });

  it("schedules 10,000 tasks without quadratic queue behavior", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => task(`t${index}`, "2026-01-05"));
    const dependencies = tasks.slice(1).map((item, index) => dep(tasks[index].id, item.id));
    const started = performance.now();
    const result = schedule(project(tasks, dependencies));
    expect(result.tasks).toHaveLength(10_000);
    expect(result.diagnostics).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
