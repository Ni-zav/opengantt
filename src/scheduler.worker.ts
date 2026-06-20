/// <reference lib="webworker" />
import type { Project } from "./model";
import { schedule } from "./scheduler";

self.onmessage = (event: MessageEvent<Project>) => self.postMessage(schedule(event.data));
