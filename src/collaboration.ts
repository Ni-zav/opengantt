import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { clearDocument } from "y-indexeddb";
import * as Y from "yjs";
import type { Project } from "./model";
import { applyProjectToY, INITIAL_ORIGIN, isEmptyProjectDoc, LOCAL_ORIGIN, projectFromY, projectYTypes } from "./yProject";

export const collaborationConfigured = Boolean(import.meta.env.VITE_COLLAB_URL);
export const clearCollaborationCache = (projectId: string) => clearDocument(`opengantt-y-${projectId}`);

export interface Collaborator {
  clientId: number;
  user: { id: string | null; name: string; color: string };
  selection?: { taskId: string };
}

interface Options {
  project: Project;
  token: string;
  user: Collaborator["user"];
  onProject(project: Project): void;
  onStatus(status: "offline" | "connecting" | "connected" | "synced" | "error"): void;
  onCollaborators(collaborators: Collaborator[]): void;
}

export class CollaborationBinding {
  readonly doc = new Y.Doc();
  readonly persistence: IndexeddbPersistence;
  readonly undoManager: Y.UndoManager;
  provider: HocuspocusProvider | null = null;
  private options: Options;
  private emitQueued = false;
  private destroyed = false;
  private bootstrapped = false;
  private pendingProject: Project | null = null;

  constructor(options: Options) {
    this.options = options;
    this.persistence = new IndexeddbPersistence(`opengantt-y-${options.project.id}`, this.doc);
    const types = projectYTypes(this.doc);
    this.undoManager = new Y.UndoManager([types.meta, types.tasks, types.dependencies, types.calendars, types.threads], {
      trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 500
    });
  }

  async start() {
    this.options.onStatus("connecting");
    await this.persistence.whenSynced;
    const hasLocalState = !isEmptyProjectDoc(this.doc);
    if (hasLocalState) { this.options.onProject(projectFromY(this.doc)); this.bootstrapped = true; }
    this.doc.on("afterTransaction", this.afterTransaction);
    if (!collaborationConfigured || !navigator.onLine) {
      if (!hasLocalState) applyProjectToY(this.doc, this.options.project, INITIAL_ORIGIN);
      this.bootstrapped = true;
      this.flushPending();
      this.options.onStatus("offline"); return;
    }
    this.provider = new HocuspocusProvider({
      url: import.meta.env.VITE_COLLAB_URL,
      name: this.options.project.id,
      document: this.doc,
      token: this.options.token,
      onStatus: ({ status }) => this.options.onStatus(status === "connected" ? "connected" : "connecting"),
      onSynced: () => {
        if (isEmptyProjectDoc(this.doc)) applyProjectToY(this.doc, this.options.project, INITIAL_ORIGIN);
        this.bootstrapped = true;
        this.flushPending();
        this.options.onStatus("synced");
      },
      onAuthenticationFailed: () => this.options.onStatus("error"),
      onDisconnect: () => this.options.onStatus(navigator.onLine ? "connecting" : "offline"),
      onAwarenessChange: () => this.emitCollaborators()
    });
    this.provider.setAwarenessField("user", this.options.user);
  }

  private afterTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN || transaction.origin === INITIAL_ORIGIN || this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      try { this.options.onProject(projectFromY(this.doc)); } catch { this.options.onStatus("error"); }
    });
  };

  private emitCollaborators() {
    const states = this.provider?.awareness?.getStates() ?? new Map();
    const collaborators: Collaborator[] = [];
    for (const [clientId, state] of states) if (state.user) collaborators.push({ clientId, user: state.user, selection: state.selection });
    this.options.onCollaborators(collaborators);
  }

  private flushPending() {
    if (this.pendingProject) { const project = this.pendingProject; this.pendingProject = null; applyProjectToY(this.doc, project, LOCAL_ORIGIN); }
  }

  apply(project: Project) {
    if (!this.bootstrapped) this.pendingProject = project;
    else applyProjectToY(this.doc, project, LOCAL_ORIGIN);
  }
  select(taskId: string) { this.provider?.setAwarenessField("selection", taskId ? { taskId } : null); }
  undo() { this.undoManager.undo(); }
  redo() { this.undoManager.redo(); }
  canUndo() { return this.undoManager.undoStack.length > 0; }
  canRedo() { return this.undoManager.redoStack.length > 0; }

  async destroy(clearLocal = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("afterTransaction", this.afterTransaction);
    this.provider?.destroy();
    this.undoManager.destroy();
    if (clearLocal) await this.persistence.clearData();
    else this.persistence.destroy();
    this.doc.destroy();
  }
}
