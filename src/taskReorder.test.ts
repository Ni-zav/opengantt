import { describe, expect, it } from "vitest";
import { createTask } from "./model";
import { moveTasks } from "./taskReorder";

const task = (id: string, order: number, parentId: string | null = null) => ({ ...createTask(order), id, name: id, parentId });

describe("task row reordering", () => {
  it("indents inside a target and moves parent subtrees together", () => {
    const nested = moveTasks([task("a", 0), task("b", 1), task("c", 2, "b"), task("d", 3)], "d", "a", "inside");
    expect(nested.map(item => item.id)).toEqual(["a", "d", "b", "c"]);
    expect(nested.find(item => item.id === "d")?.parentId).toBe("a");

    const moved = moveTasks(nested, "b", "a", "before");
    expect(moved.map(item => item.id)).toEqual(["b", "c", "a", "d"]);
    expect(moved.find(item => item.id === "c")?.parentId).toBe("b");
  });
});
