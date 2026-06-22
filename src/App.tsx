import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBendDownRight, ArrowClockwise, ArrowCounterClockwise, ArrowLineLeft, ArrowLineRight, BracketsCurly, CaretDown, CaretRight,
  ChartBarHorizontal, CircleNotch, Command, DotsSixVertical, DownloadSimple, FileCsv, FileXls, FolderOpen, Info,
  LinkSimple, ListBullets, MagnifyingGlass, Plus, Rows, RowsPlusBottom, SidebarSimple, SlidersHorizontal,
  Trash, UploadSimple, WarningCircle, X
} from "@phosphor-icons/react";
import { exportCsv, exportOpenGantt, exportProjectXml, importOpenGantt } from "./io";
import { createTask, isoToday, sampleProject, uid, type DependencyType, type Project, type Task } from "./model";
import { schedule, type ScheduleResult } from "./scheduler";
import { previewSchedule } from "./schedulePreview";
import { moveTasks, type DropPlacement } from "./taskReorder";
import { deleteProject, loadProjects, saveProject } from "./storage";
import CloudPanel from "./CloudPanel";
import { saveCloudProject, type CloudProject, type CloudSession } from "./cloud";
import { importCsv, importMspdi, inspectCsv, type CsvMapping } from "./interchange";
import type { CollaborationBinding, Collaborator } from "./collaboration";
import { exportXlsx, importXlsx } from "./xlsx";

const ROW_HEIGHT = 42;
const DAY_WIDTH = 28;
const GRID_WIDTH = 670;
const collaborationConfigured = Boolean(import.meta.env.VITE_COLLAB_URL);

const dateNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const dayDiff = (from: string, to: string) => Math.round((dateNumber(to) - dateNumber(from)) / 86_400_000);
const addDays = (iso: string, days: number) => new Date(dateNumber(iso) + days * 86_400_000).toISOString().slice(0, 10);

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [saveState, setSaveState] = useState("Saved locally");
  const [scrollTop, setScrollTop] = useState(0);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newDepFrom, setNewDepFrom] = useState("");
  const [newDepType, setNewDepType] = useState<DependencyType>("FS");
  const [newDepLag, setNewDepLag] = useState(0);
  const [holidayDate, setHolidayDate] = useState("");
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [cloudProjects, setCloudProjects] = useState<Record<string, CloudProject>>({});
  const [csvImport, setCsvImport] = useState<{ text: string; headers: string[]; preview: string[][]; mapping: CsvMapping } | null>(null);
  const [advancedMode, setAdvancedMode] = useState(() => localStorage.getItem("opengantt.advanced") === "true");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "timeline">("list");
  const [commentDraft, setCommentDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem("opengantt.welcome.dismissed") !== "true");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState("");
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: DropPlacement } | null>(null);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const workbenchRef = useRef<HTMLElement>(null);
  const scheduledProjectId = useRef("");
  const collaboration = useRef<CollaborationBinding | null>(null);
  const [collaborationStatus, setCollaborationStatus] = useState<"offline" | "connecting" | "connected" | "synced" | "error">("offline");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjects().then(found => {
      const initial = found.length ? found : [sampleProject()];
      setProjects(initial);
      setActiveId(initial[0].id);
      if (!found.length) saveProject(initial[0]);
    }).catch(() => {
      const initial = sampleProject();
      setProjects([initial]);
      setActiveId(initial.id);
      setSaveState("Storage unavailable");
    });
  }, []);

  const project = projects.find(item => item.id === activeId);
  useEffect(() => {
    if (!project) return;
    if (scheduledProjectId.current !== project.id) {
      scheduledProjectId.current = project.id;
      setScheduleResult(null);
    }
    let worker: Worker | undefined;
    const timeout = window.setTimeout(() => {
      worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<ScheduleResult>) => setScheduleResult(event.data);
      worker.onerror = () => setScheduleResult(schedule(project));
      worker.postMessage(project);
    }, 16);
    return () => {
      window.clearTimeout(timeout);
      worker?.terminate();
    };
  }, [project]);
  const scheduled = scheduleResult?.tasks ?? [];
  const ordered = useMemo(() => [...scheduled].sort((a, b) => a.order - b.order), [scheduled]);
  const taskById = useMemo(() => new Map(project?.tasks.map(task => [task.id, task]) ?? []), [project?.tasks]);
  const parentIds = useMemo(() => new Set(project?.tasks.map(task => task.parentId).filter((id): id is string => Boolean(id)) ?? []), [project?.tasks]);
  const displayed = useMemo(() => collapsedIds.size ? ordered.filter(task => {
    let parentId = task.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (collapsedIds.has(parentId)) return false;
      seen.add(parentId);
      parentId = taskById.get(parentId)?.parentId ?? null;
    }
    return true;
  }) : ordered, [collapsedIds, ordered, taskById]);
  const timelineStart = useMemo(() => {
    const first = ordered.map(t => t.start).sort()[0] ?? isoToday();
    return addDays(first, -3);
  }, [ordered]);
  const timelineEnd = useMemo(() => addDays(ordered.map(t => t.end).sort().at(-1) ?? isoToday(), 14), [ordered]);
  const timelineDays = Math.max(45, dayDiff(timelineStart, timelineEnd));
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop - 48) / ROW_HEIGHT) - 6);
  const visible = displayed.slice(firstVisible, firstVisible + 30);
  const scheduledById = useMemo(() => new Map(ordered.map(task => [task.id, task])), [ordered]);
  const displayedIndex = useMemo(() => new Map(displayed.map((task, index) => [task.id, index])), [displayed]);
  const hierarchyLinks = useMemo(() => visible.flatMap(task => {
    if (!task.parentId) return [];
    const parent = scheduledById.get(task.parentId), parentIndex = displayedIndex.get(task.parentId), childIndex = displayedIndex.get(task.id);
    if (!parent || parentIndex === undefined || childIndex === undefined) return [];
    const parentX = dayDiff(timelineStart, parent.start) * DAY_WIDTH;
    const childX = dayDiff(timelineStart, task.start) * DAY_WIDTH - 5;
    const childY = childIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
    const bendX = Math.max(6, Math.min(parentX, childX) - 12);
    return [{ id: `${parent.id}-${task.id}`, color: outlineFor(task), path: `M ${parentX} ${parentIndex * ROW_HEIGHT + ROW_HEIGHT / 2} H ${bendX} V ${childY} H ${childX}`, arrow: `M ${childX} ${childY} L ${childX - 8} ${childY - 4} L ${childX - 8} ${childY + 4} Z` }];
  }), [displayedIndex, scheduledById, taskById, timelineStart, visible]);
  const selected = project?.tasks.find(task => task.id === selectedId);
  const activeCloud = project ? cloudProjects[project.id] : undefined;
  const readOnly = activeCloud?.role === "viewer";
  const collaborationToken = activeCloud?.shareSlug ? `public:${activeCloud.shareSlug}` : cloudSession?.accessToken ?? "";

  useEffect(() => setCollapsedIds(new Set()), [activeId]);

  useEffect(() => {
    if (!project || !activeCloud || !collaborationToken || !collaborationConfigured) return;
    let cancelled = false, binding: CollaborationBinding | null = null;
    import("./collaboration").then(module => {
      if (cancelled) return;
      binding = new module.CollaborationBinding({
        project, token: collaborationToken,
        user: { id: cloudSession?.user.id ?? null, name: cloudSession?.user.email || "Guest viewer", color: `hsl(${Math.abs((cloudSession?.user.id ?? activeCloud.shareSlug ?? "guest").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) * 47) % 360} 55% 45%)` },
        onProject: next => {
          setProjects(current => current.map(item => item.id === next.id ? next : item));
          saveProject(next);
        },
        onStatus: setCollaborationStatus,
        onCollaborators: setCollaborators
      });
      collaboration.current = binding;
      binding.start().then(() => binding?.select(selectedId)).catch(() => setCollaborationStatus("error"));
    }).catch(() => setCollaborationStatus("error"));
    return () => {
      cancelled = true;
      if (collaboration.current === binding) collaboration.current = null;
      binding?.destroy();
      setCollaborators([]);
    };
  }, [project?.id, activeCloud?.id, collaborationToken]);

  useEffect(() => {
    if (project && collaboration.current) collaboration.current.apply(project);
  }, [project]);

  useEffect(() => collaboration.current?.select(selectedId), [selectedId]);

  useEffect(() => {
    if (!project || !cloudSession || !activeCloud || activeCloud.role === "viewer" || (collaborationConfigured && collaboration.current)) return;
    const timeout = window.setTimeout(() => {
      setSaveState("Syncing…");
      saveCloudProject(cloudSession, project).then(() => setSaveState("Saved to cloud"), () => setSaveState("Cloud save failed"));
    }, 800);
    return () => clearTimeout(timeout);
  }, [project, cloudSession, activeCloud?.id, activeCloud?.role]);

  function commit(change: (draft: Project) => void) {
    if (!project || readOnly) return;
    if (!collaboration.current) {
      undoStack.current = [...undoStack.current.slice(-49), structuredClone(project)];
      redoStack.current = [];
    }
    const draft = structuredClone(project);
    change(draft);
    draft.updatedAt = new Date().toISOString();
    setScheduleResult(current => previewSchedule(current, draft));
    setProjects(current => current.map(item => item.id === draft.id ? draft : item));
    saveProject(draft).then(() => setSaveState("Saved locally"), () => setSaveState("Save failed"));
  }

  function restore(next: Project) {
    setScheduleResult(current => previewSchedule(current, next));
    setProjects(current => current.map(item => item.id === next.id ? next : item));
    saveProject(next).then(() => setSaveState(activeCloud ? "Syncing…" : "Saved locally"));
  }

  function undo() {
    if (collaboration.current) { collaboration.current.undo(); return; }
    if (!project || !undoStack.current.length || readOnly) return;
    const previous = undoStack.current.pop()!;
    redoStack.current.push(structuredClone(project));
    restore(previous);
  }

  function redo() {
    if (collaboration.current) { collaboration.current.redo(); return; }
    if (!project || !redoStack.current.length || readOnly) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(structuredClone(project));
    restore(next);
  }

  function updateTask(id: string, patch: Partial<Task>) {
    commit(draft => Object.assign(draft.tasks.find(task => task.id === id)!, patch));
  }

  function addTask() {
    const task = createTask(ordered.length, ordered.at(-1)?.end ?? isoToday());
    commit(draft => draft.tasks.push(task));
    setSelectedId(task.id);
  }

  function removeSelected() {
    if (!selectedId) return;
    commit(draft => {
      draft.tasks = draft.tasks.filter(task => task.id !== selectedId);
      draft.dependencies = draft.dependencies.filter(dep => dep.from !== selectedId && dep.to !== selectedId);
      draft.commentThreads = draft.commentThreads.filter(thread => thread.taskId !== selectedId);
    });
    setSelectedId("");
  }

  function linkPrevious() {
    const index = displayed.findIndex(task => task.id === selectedId);
    if (index < 1 || !project) return;
    const from = displayed[index - 1].id;
    if (project.dependencies.some(dep => dep.from === from && dep.to === selectedId)) return;
    commit(draft => draft.dependencies.push({ id: uid(), from, to: selectedId, type: "FS", lag: 0 }));
  }

  function addDependency() {
    if (!selectedId || !newDepFrom || selectedId === newDepFrom || !project) return;
    if (project.dependencies.some(dep => dep.from === newDepFrom && dep.to === selectedId)) return;
    commit(draft => draft.dependencies.push({ id: uid(), from: newDepFrom, to: selectedId, type: newDepType, lag: newDepLag }));
  }

  function indentSelected() {
    const index = displayed.findIndex(task => task.id === selectedId);
    if (index < 1) return;
    const previous = displayed[index - 1];
    const selectedDepth = depthFor(displayed[index]);
    let parent: Task = previous;
    while (depthFor(parent) > selectedDepth && parent.parentId) parent = taskById.get(parent.parentId) ?? parent;
    const repairsLegacyChain = displayed[index].parentId === previous.id && Boolean(previous.parentId) && previous.type === "summary";
    const parentId = repairsLegacyChain ? previous.parentId! : parent.id;
    commit(draft => {
      const selectedTask = draft.tasks.find(task => task.id === selectedId)!;
      const previousTask = draft.tasks.find(task => task.id === previous.id)!;
      if (repairsLegacyChain) previousTask.type = "task";
      selectedTask.parentId = parentId;
    });
  }

  function outdentSelected() {
    if (!selected?.parentId) return;
    const parent = project!.tasks.find(task => task.id === selected.parentId);
    updateTask(selected.id, { parentId: parent?.parentId ?? null });
  }

  function depthFor(task: Task) {
    let depth = 0, parent = task.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent); depth++; parent = taskById.get(parent)?.parentId ?? null;
    }
    return depth;
  }

  function outlineFor(task: Task) {
    let root = task;
    const seen = new Set<string>();
    while (root.parentId && !seen.has(root.id)) {
      seen.add(root.id);
      root = taskById.get(root.parentId) ?? root;
    }
    const hue = [...root.id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 360, 0);
    return `hsl(${hue} ${Math.max(30, 72 - depthFor(task) * 11)}% 55%)`;
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function dragPlacement(event: React.DragEvent<HTMLDivElement>, task: Task): DropPlacement {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    if (x < 250 && x > 52 + depthFor(task) * 18) return "inside";
    return event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
  }

  function dragOver(event: React.DragEvent<HTMLDivElement>, task: Task) {
    if (!draggedId || draggedId === task.id || readOnly) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const next = { id: task.id, placement: dragPlacement(event, task) };
    setDropTarget(current => current?.id === next.id && current.placement === next.placement ? current : next);
  }

  function dropTask(event: React.DragEvent<HTMLDivElement>, task: Task) {
    event.preventDefault();
    if (!draggedId || readOnly) return;
    let parent: Task | undefined = task;
    const seen = new Set<string>();
    while (parent && !seen.has(parent.id)) {
      if (parent.id === draggedId) { setDropTarget(null); return; }
      seen.add(parent.id);
      parent = parent.parentId ? taskById.get(parent.parentId) : undefined;
    }
    const placement = dragPlacement(event, task);
    commit(draft => { draft.tasks = moveTasks(draft.tasks, draggedId, task.id, placement); });
    setSelectedId(draggedId);
    setDraggedId("");
    setDropTarget(null);
  }

  function focusGridCell(row: number, column: number) {
    if (row < 0 || row >= displayed.length || column < 0 || column > 3) return;
    const focus = () => workbenchRef.current?.querySelector<HTMLElement>(`[data-grid-row="${displayed[row].id}"][data-grid-col="${column}"]`)?.focus();
    if (!workbenchRef.current?.querySelector(`[data-grid-row="${displayed[row].id}"]`)) {
      workbenchRef.current?.scrollTo({ top: 48 + row * ROW_HEIGHT });
      setTimeout(focus);
    } else focus();
  }

  function gridKey(event: React.KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    let nextRow = row, nextColumn = column;
    if (event.key === "ArrowUp") nextRow--;
    else if (event.key === "ArrowDown") nextRow++;
    else if (event.key === "Home") { nextColumn = 0; if (event.ctrlKey) nextRow = 0; }
    else if (event.key === "End") { nextColumn = 3; if (event.ctrlKey) nextRow = displayed.length - 1; }
    else if (event.key === "ArrowLeft" && (event.currentTarget.selectionStart == null || event.currentTarget.selectionStart === 0)) nextColumn--;
    else if (event.key === "ArrowRight" && (event.currentTarget.selectionEnd == null || event.currentTarget.selectionEnd === event.currentTarget.value.length)) nextColumn++;
    else return;
    if (nextRow !== row || nextColumn !== column) { event.preventDefault(); focusGridCell(nextRow, nextColumn); }
  }

  function comment(body: string, threadId?: string) {
    const clean = body.trim();
    if (!clean || !selected || readOnly) return;
    const entry = {
      id: uid(), authorId: cloudSession?.user.id ?? null, authorName: cloudSession?.user.email || "Local user",
      body: clean, mentions: [...clean.matchAll(/(^|\s)@([\w.+-]+(?:@[\w.-]+)?)/g)].map(match => match[2]), createdAt: new Date().toISOString()
    };
    commit(draft => {
      if (threadId) draft.commentThreads.find(thread => thread.id === threadId)?.comments.push(entry);
      else draft.commentThreads.push({ id: uid(), taskId: selected.id, resolved: false, comments: [entry] });
    });
    if (threadId) setReplyDrafts(current => ({ ...current, [threadId]: "" })); else setCommentDraft("");
  }

  function newProject() {
    const next = sampleProject();
    next.name = "Untitled project";
    next.tasks = [];
    next.dependencies = [];
    setProjects(current => [...current, next]);
    setActiveId(next.id);
    saveProject(next);
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        setSaveState("Importing workbook…");
        const report = await importXlsx(file);
        await finishImport(report.project, report.warnings);
        return;
      }
      if (file.size > 25 * 1024 * 1024) throw new Error("Text imports are limited to 25 MB.");
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) {
        const inspected = inspectCsv(text); setCsvImport({ text, ...inspected }); return;
      }
      const report = file.name.toLowerCase().endsWith(".xml") ? importMspdi(text) : { project: importOpenGantt(text), warnings: [] };
      await finishImport(report.project, report.warnings);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Import failed.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function finishImport(imported: Project, warnings: string[] = []) {
    setProjects(current => [...current, imported]);
    setActiveId(imported.id);
    await saveProject(imported);
    setSaveState(warnings.length ? `Imported with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Imported locally");
    setImportWarnings(warnings);
  }

  function openCloudProject(next: Project, cloud: CloudProject) {
    setProjects(current => [...current.filter(item => item.id !== next.id), next]);
    setCloudProjects(current => ({ ...current, [next.id]: cloud }));
    setActiveId(next.id);
    setSelectedId("");
    saveProject(next);
  }

  function removeCloudProject(id: string) {
    deleteProject(id);
    setCloudProjects(current => { const next = { ...current }; delete next[id]; return next; });
    setProjects(current => {
      const remaining = current.filter(item => item.id !== id);
      if (activeId === id) {
        const fallback = remaining[0] ?? sampleProject();
        if (!remaining.length) { remaining.push(fallback); saveProject(fallback); }
        setActiveId(fallback.id);
      }
      return remaining;
    });
  }

  function handleCloudSession(next: CloudSession | null) {
    if (!next && cloudSession) {
      collaboration.current?.destroy(true);
      collaboration.current = null;
      const cloudIds = new Set(Object.keys(cloudProjects));
      cloudIds.forEach(id => deleteProject(id));
      if (collaborationConfigured) import("./collaboration").then(module => Promise.all([...cloudIds].map(id => module.clearCollaborationCache(id))));
      const remaining = projects.filter(item => !cloudIds.has(item.id));
      if (cloudIds.has(activeId)) {
        const fallback = remaining[0] ?? sampleProject();
        if (!remaining.length) { remaining.push(fallback); saveProject(fallback); }
        setActiveId(fallback.id);
      }
      setProjects(remaining);
      setCloudProjects({});
    }
    setCloudSession(next);
  }

  function toggleAdvanced() {
    setAdvancedMode(value => { localStorage.setItem("opengantt.advanced", String(!value)); return !value; });
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = target.matches("input, textarea, select");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && project) { event.preventDefault(); exportOpenGantt(project); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (!editing && event.key === "Delete") removeSelected();
      if (event.key === "Escape") { setCommandOpen(false); setShowAdvanced(false); }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [project, selectedId, readOnly]);

  if (!project) return <main className="loading"><CircleNotch size={22} className="spin" /><span>Opening your workspace</span></main>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Rows size={17} weight="bold" /></span><span>OpenGantt</span></div>
        <div className="project-switcher">
          <select aria-label="Current project" value={activeId} onChange={e => setActiveId(e.target.value)}>
            {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <CaretDown size={12} weight="bold" aria-hidden="true" />
        </div>
        <button className="icon-button" aria-label="New project" title="New project" onClick={newProject}><Plus size={17} weight="bold" /></button>
        <div className="topbar-spacer" />
        {activeCloud && collaborationConfigured && <span className={`sync-pill ${collaborationStatus}`} role="status" aria-live="polite">{collaborationStatus}</span>}
        {collaborators.length > 0 && <div className="collaborators" aria-label={`${collaborators.length} connected participant${collaborators.length === 1 ? "" : "s"}`}>{collaborators.slice(0, 4).map(person => <span key={person.clientId} title={`${person.user.name}${person.selection?.taskId ? " · selecting a task" : ""}`} style={{ background: person.user.color }}>{person.user.name.slice(0, 1).toUpperCase()}</span>)}{collaborators.length > 4 && <b>+{collaborators.length - 4}</b>}</div>}
        <div className="toolbar-group history-actions">
          <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly || (!collaboration.current?.canUndo() && !undoStack.current.length)} onClick={undo}><ArrowCounterClockwise size={17} /></button>
          <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={readOnly || (!collaboration.current?.canRedo() && !redoStack.current.length)} onClick={redo}><ArrowClockwise size={17} /></button>
        </div>
        <button className="command-button" title="Commands (Ctrl+K)" onClick={() => setCommandOpen(true)}><Command size={16} /><span>Commands</span><kbd>Ctrl K</kbd></button>
        <span className={`save-state ${saveState.includes("fail") ? "error" : ""}`} role="status" aria-live="polite">{saveState}</span>
        <CloudPanel current={project} activeCloud={activeCloud} onOpen={openCloudProject} onSession={handleCloudSession} onDelete={removeCloudProject} />
        <div className="toolbar-group file-actions">
        <button title="Import project" onClick={() => fileInput.current?.click()}><UploadSimple size={16} /><span>Import</span></button>
        <input ref={fileInput} hidden type="file" accept=".opengantt,.csv,.xml,.xlsx,application/json,text/csv,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => importFile(e.target.files?.[0])} />
        <button className="format-button" title="Export CSV" onClick={() => exportCsv(project)}><FileCsv size={16} /><span>CSV</span></button>
        <button className="format-button" title="Export Excel workbook" onClick={() => { setSaveState("Creating workbook…"); exportXlsx(project).then(() => setSaveState("Workbook exported"), error => { setSaveState("XLSX export failed"); alert(error.message); }); }}><FileXls size={16} /><span>XLSX</span></button>
        <button className="format-button" title="Export Microsoft Project XML" onClick={() => exportProjectXml(project)}><BracketsCurly size={16} /><span>XML</span></button>
        <button className="primary export-button" onClick={() => exportOpenGantt(project)}><DownloadSimple size={16} weight="bold" /><span>Export</span></button>
        </div>
      </header>

      <section className="project-heading">
        <div className="project-meta">
          <input disabled={readOnly} className="project-name" aria-label="Project name" value={project.name} onChange={e => commit(d => { d.name = e.target.value; })} />
          <p><span className={`project-state ${activeCloud ? "cloud" : "local"}`}>{activeCloud ? activeCloud.role : "Local"}</span>{activeCloud ? `${activeCloud.visibility} cloud project` : "Private on this device"}</p>
        </div>
        <div className="toolbar" aria-label="Task tools">
          <div className="mobile-switch segmented" role="group" aria-label="Mobile view"><button aria-pressed={mobileView === "list"} className={mobileView === "list" ? "active" : ""} onClick={() => setMobileView("list")}><ListBullets size={15} />List</button><button aria-pressed={mobileView === "timeline"} className={mobileView === "timeline" ? "active" : ""} onClick={() => setMobileView("timeline")}><ChartBarHorizontal size={15} />Timeline</button></div>
          <button className="add-task" disabled={readOnly} onClick={addTask}><Plus size={16} weight="bold" />Add task</button>
          {advancedMode && <div className="toolbar-group advanced-actions"><button disabled={!selectedId || readOnly} onClick={linkPrevious}><LinkSimple size={15} />Link previous</button><button title="Indent" disabled={!selectedId || readOnly} onClick={indentSelected}><ArrowLineRight size={15} /><span>Indent</span></button><button title="Outdent" disabled={!selected?.parentId || readOnly} onClick={outdentSelected}><ArrowLineLeft size={15} /><span>Outdent</span></button><button disabled={!selectedId} onClick={() => setShowAdvanced(value => !value)}><SidebarSimple size={15} /><span>Details</span></button></div>}
          <button className="mode-button" aria-pressed={advancedMode} onClick={toggleAdvanced}><SlidersHorizontal size={15} /><span>{advancedMode ? "Advanced" : "Simple"}</span></button>
          <button title="Delete selected task" disabled={!selectedId || readOnly} className="danger icon-button" onClick={removeSelected}><Trash size={16} /></button>
        </div>
      </section>
      {showWelcome && <section className="welcome-banner"><Info size={19} weight="fill" /><div><strong>Your plans stay on this device</strong><span>Add tasks or import a file. Sign in only when you want cloud sharing.</span></div><button onClick={() => { localStorage.setItem("opengantt.welcome.dismissed", "true"); setShowWelcome(false); }}>Got it</button></section>}

      {scheduleResult?.diagnostics.length ? <div className="diagnostics" role="status"><WarningCircle size={17} weight="fill" /><span><b>{scheduleResult.diagnostics.length} schedule issue{scheduleResult.diagnostics.length === 1 ? "" : "s"}</b>{scheduleResult.diagnostics[0].message}</span></div> : null}
      <main ref={workbenchRef} id="workbench" className={`workbench mobile-${mobileView}`} role="grid" aria-label="Project tasks and timeline" aria-rowcount={displayed.length + 1 + (displayed.length ? 1 : 0)} aria-colcount={4} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="table-head" role="row" aria-rowindex={1} style={{ width: GRID_WIDTH }}>
          <span role="columnheader">Task</span><span role="columnheader">Start</span><span role="columnheader">Days</span><span role="columnheader">Progress</span>
        </div>
        <div className="timeline-head" aria-hidden="true" style={{ left: GRID_WIDTH, width: timelineDays * DAY_WIDTH }}>
          {Array.from({ length: timelineDays }, (_, index) => {
            const date = addDays(timelineStart, index);
            return <span className={date.endsWith("-01") ? "month" : ""} key={date} style={{ left: index * DAY_WIDTH }}>{new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</span>;
          })}
        </div>
        <div className="rows-space" style={{ height: displayed.length * ROW_HEIGHT + (displayed.length ? ROW_HEIGHT : 0), width: GRID_WIDTH + timelineDays * DAY_WIDTH }}>
          <svg className="hierarchy-links" aria-hidden="true" style={{ left: GRID_WIDTH, top: 0, width: timelineDays * DAY_WIDTH, height: displayed.length * ROW_HEIGHT }}>
            {hierarchyLinks.map(link => <g key={link.id}><path className="hierarchy-line" d={link.path} style={{ stroke: link.color }} /><path className="hierarchy-arrow" d={link.arrow} style={{ fill: link.color }} /></g>)}
          </svg>
          {visible.map((task, localIndex) => {
            const index = firstVisible + localIndex;
            const top = index * ROW_HEIGHT;
            const left = dayDiff(timelineStart, task.start) * DAY_WIDTH;
            const width = Math.max(task.type === "milestone" ? 12 : DAY_WIDTH, Math.max(1, dayDiff(task.start, task.end) + 1) * DAY_WIDTH);
            const hasChildren = parentIds.has(task.id);
            const remoteSelector = collaborators.find(person => person.selection?.taskId === task.id && person.user.id !== cloudSession?.user.id);
            const placement = dropTarget?.id === task.id ? dropTarget.placement : "";
            return <div role="row" tabIndex={-1} aria-rowindex={index + 2} aria-selected={selectedId === task.id} aria-invalid={task.invalid || undefined} title={remoteSelector ? `${remoteSelector.user.name} is selecting this task` : undefined} className={`task-row ${hasChildren ? "group-row" : ""} ${selectedId === task.id ? "selected" : ""} ${draggedId === task.id ? "dragging" : ""} ${placement ? `drop-${placement}` : ""} ${remoteSelector ? "remote-selected" : ""}`} key={task.id} style={{ top, ...(remoteSelector ? { boxShadow: `inset 3px 0 ${remoteSelector.user.color}` } : {}) }} onClick={() => setSelectedId(task.id)} onDragOver={event => dragOver(event, task)} onDrop={event => dropTask(event, task)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}>
              <div className="task-cells" style={{ width: GRID_WIDTH }}>
                <div className="task-name-cell" style={{ paddingLeft: 10 + depthFor(task) * 18 }}>
                  <button type="button" className="drag-handle" draggable={!readOnly} disabled={readOnly} aria-label={`Move ${task.name}`} title="Drag to reorder; move right over a task to indent" onClick={event => event.stopPropagation()} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); setSelectedId(task.id); setDraggedId(task.id); }} onDragEnd={() => { setDraggedId(""); setDropTarget(null); }}><DotsSixVertical aria-hidden="true" /></button>
                  {hasChildren ? <button type="button" className="hierarchy-toggle" aria-label={`${collapsedIds.has(task.id) ? "Expand" : "Collapse"} ${task.name}`} aria-expanded={!collapsedIds.has(task.id)} onClick={event => { event.stopPropagation(); toggleCollapsed(task.id); }}>{collapsedIds.has(task.id) ? <CaretRight aria-hidden="true" /> : <CaretDown aria-hidden="true" />}</button> : task.parentId ? <ArrowBendDownRight className="hierarchy-branch" aria-hidden="true" /> : <span className="hierarchy-spacer" />}
                  <input role="gridcell" data-grid-row={task.id} data-grid-col="0" disabled={readOnly} aria-label={`Task name row ${index + 1}`} style={{ fontWeight: hasChildren ? 700 : 400 }} value={task.name} onFocus={() => setSelectedId(task.id)} onKeyDown={event => gridKey(event, index, 0)} onChange={e => updateTask(task.id, { name: e.target.value })} />
                </div>
                <input role="gridcell" data-grid-row={task.id} data-grid-col="1" disabled={readOnly || hasChildren} aria-label={`${hasChildren ? "Calculated " : ""}Start date for ${task.name}`} title={hasChildren ? "Calculated from child tasks" : undefined} type="date" value={task.start} onFocus={() => setSelectedId(task.id)} onKeyDown={event => gridKey(event, index, 1)} onChange={e => updateTask(task.id, { start: e.target.value })} />
                <input role="gridcell" data-grid-row={task.id} data-grid-col="2" disabled={readOnly || hasChildren} aria-label={`${hasChildren ? "Calculated " : ""}Duration for ${task.name}`} title={hasChildren ? "Calculated from child tasks" : undefined} type="number" min="0" value={task.duration} onFocus={() => setSelectedId(task.id)} onKeyDown={event => gridKey(event, index, 2)} onChange={e => { const duration = Math.max(0, Number(e.target.value)); updateTask(task.id, { duration, type: task.type === "milestone" && duration > 0 ? "task" : task.type }); }} />
                <div className="progress-cell" title={hasChildren ? "Calculated from child tasks" : undefined}><input role="gridcell" data-grid-row={task.id} data-grid-col="3" disabled={readOnly || hasChildren} aria-label={`${hasChildren ? "Calculated " : ""}Progress for ${task.name}`} type="range" min="0" max="100" value={task.progress} onFocus={() => setSelectedId(task.id)} onKeyDown={event => gridKey(event, index, 3)} onChange={e => updateTask(task.id, { progress: Number(e.target.value) })} /><span>{task.progress}%</span></div>
              </div>
              <div className="timeline-row" style={{ left: GRID_WIDTH, width: timelineDays * DAY_WIDTH }}>
                <div className={`bar ${task.critical ? "critical" : ""} ${task.invalid ? "invalid" : ""} ${hasChildren ? "group" : task.type}`} title={`${task.name}: ${task.start} – ${task.end}`} style={{ left, width, borderColor: task.invalid ? undefined : outlineFor(task) }}>
                  {(task.type === "task" || hasChildren) && <i style={{ width: `${task.progress}%` }} />}
                </div>
              </div>
            </div>;
          })}
          {displayed.length ? <div className="bottom-add-row" role="row" aria-rowindex={displayed.length + 2} style={{ top: displayed.length * ROW_HEIGHT, width: GRID_WIDTH }}><button disabled={readOnly} onClick={addTask}><Plus size={15} />Add task</button></div> : null}
        </div>
        {!ordered.length && <div className="empty-state"><span className="empty-state-icon"><RowsPlusBottom size={25} /></span><strong>Start with your first task</strong><p>Build a plan from scratch or bring in an existing OpenGantt, Excel, CSV, or Project file.</p><div><button className="primary" disabled={readOnly} onClick={addTask}><Plus size={16} />Add task</button><button onClick={() => fileInput.current?.click()}><FolderOpen size={16} />Import file</button></div></div>}
      </main>
      {showAdvanced && selected && <aside className="inspector" aria-label="Task details">
        <header><div><span className="panel-kicker">Selected task</span><strong>{selected.name || "Task details"}</strong></div><button className="icon-button" aria-label="Close details" onClick={() => setShowAdvanced(false)}><X size={17} /></button></header>
        <label>Type<select value={selected.type} onChange={e => updateTask(selected.id, { type: e.target.value as Task["type"], duration: e.target.value === "milestone" ? 0 : Math.max(1, selected.duration) })}><option value="task">Task</option><option value="milestone">Milestone</option><option value="summary">Summary</option></select></label>
        <label>Scheduling<select value={selected.schedulingMode} onChange={e => updateTask(selected.id, { schedulingMode: e.target.value as Task["schedulingMode"] })}><option value="auto">Automatic</option><option value="manual">Manual</option></select></label>
        <label>Calendar<select value={selected.calendarId} onChange={e => updateTask(selected.id, { calendarId: e.target.value })}>{project.calendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label>
        <label>Constraint<select value={selected.constraint.type} onChange={e => updateTask(selected.id, { constraint: { ...selected.constraint, type: e.target.value as Task["constraint"]["type"] } })}><option value="asap">As soon as possible</option><option value="start-no-earlier-than">Start no earlier than</option><option value="finish-no-later-than">Finish no later than</option><option value="must-start-on">Must start on</option><option value="must-finish-on">Must finish on</option></select></label>
        {selected.constraint.type !== "asap" && <label>Constraint date<input type="date" value={selected.constraint.date ?? selected.start} onChange={e => updateTask(selected.id, { constraint: { ...selected.constraint, date: e.target.value } })} /></label>}
        <hr />
        <strong>Add predecessor</strong>
        <label>Task<select value={newDepFrom} onChange={e => setNewDepFrom(e.target.value)}><option value="">Choose task</option>{ordered.filter(task => task.id !== selected.id && task.type !== "summary").map(task => <option value={task.id} key={task.id}>{task.name}</option>)}</select></label>
        <div className="inline-fields"><label>Type<select value={newDepType} onChange={e => setNewDepType(e.target.value as DependencyType)}><option>FS</option><option>SS</option><option>FF</option><option>SF</option></select></label><label>Lag<input type="number" value={newDepLag} onChange={e => setNewDepLag(Number(e.target.value))} /></label></div>
        <button onClick={addDependency} disabled={!newDepFrom}>Add dependency</button>
        <div className="dependency-list">{project.dependencies.filter(dep => dep.to === selected.id).map(dep => <div key={dep.id}><span>{project.tasks.find(task => task.id === dep.from)?.name} · {dep.type}{dep.lag ? ` ${dep.lag > 0 ? "+" : ""}${dep.lag}d` : ""}</span><button className="icon-button" aria-label="Remove dependency" onClick={() => commit(draft => { draft.dependencies = draft.dependencies.filter(item => item.id !== dep.id); })}><X size={14} /></button></div>)}</div>
        <hr />
        <strong>Calendar exception</strong>
        <label>Date<input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)} /></label>
        <button disabled={!holidayDate} onClick={() => commit(draft => { const calendar = draft.calendars.find(item => item.id === selected.calendarId)!; calendar.exceptions[holidayDate] = false; })}>Mark non-working</button>
        <hr />
        <strong>Comments</strong>
        <label>New thread<textarea disabled={readOnly} rows={3} maxLength={10000} placeholder="Write a comment; use @name to mention" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} /></label>
        <button disabled={readOnly || !commentDraft.trim()} onClick={() => comment(commentDraft)}>Comment</button>
        <div className="comment-threads">{project.commentThreads.filter(thread => thread.taskId === selected.id).map(thread => <article className={thread.resolved ? "resolved" : ""} key={thread.id}>
          <header><span>{thread.resolved ? "Resolved" : "Open thread"}</span><button disabled={readOnly} onClick={() => commit(draft => { const item = draft.commentThreads.find(value => value.id === thread.id)!; item.resolved = !item.resolved; })}>{thread.resolved ? "Reopen" : "Resolve"}</button></header>
          {thread.comments.map(item => <div className="comment" key={item.id}><b>{item.authorName}</b><time>{new Date(item.createdAt).toLocaleString()}</time><p>{item.body}</p>{item.mentions.length > 0 && <small>Mentions: {item.mentions.map(name => `@${name}`).join(", ")}</small>}</div>)}
          <label>Reply<textarea disabled={readOnly} rows={2} maxLength={10000} value={replyDrafts[thread.id] ?? ""} onChange={event => setReplyDrafts(current => ({ ...current, [thread.id]: event.target.value }))} /></label>
          <button disabled={readOnly || !(replyDrafts[thread.id] ?? "").trim()} onClick={() => comment(replyDrafts[thread.id] ?? "", thread.id)}>Reply</button>
        </article>)}</div>
      </aside>}
      {csvImport && <div className="modal-backdrop"><section className="cloud-panel csv-mapper" role="dialog" aria-modal="true" aria-label="Map CSV columns">
        <header><div><strong>Map spreadsheet columns</strong><small>Confirm which columns contain task data</small></div><button className="icon-button" aria-label="Cancel CSV import" onClick={() => setCsvImport(null)}><X size={17} /></button></header>
        {(["name", "start", "duration", "progress", "id", "parentId"] as const).map(field => <label key={field}>{field === "parentId" ? "Parent ID" : field[0].toUpperCase() + field.slice(1)}{field === "name" ? " *" : ""}<select value={csvImport.mapping[field] ?? ""} onChange={event => setCsvImport(current => current ? { ...current, mapping: { ...current.mapping, [field]: event.target.value || undefined } } : null)}><option value="">Not imported</option>{csvImport.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}
        <div className="csv-preview"><table><thead><tr>{csvImport.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{csvImport.preview.map((row, index) => <tr key={index}>{csvImport.headers.map((_, column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table></div>
        <button className="primary" disabled={!csvImport.mapping.name} onClick={() => {
          try { const report = importCsv(csvImport.text, csvImport.mapping); setCsvImport(null); finishImport(report.project, report.warnings); }
          catch (error) { alert(error instanceof Error ? error.message : "CSV import failed."); }
        }}>Import tasks</button>
      </section></div>}
      {commandOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Commands">
        <div className="command-search"><MagnifyingGlass size={20} /><input autoFocus aria-label="Search commands" placeholder="Search commands…" value={commandQuery} onChange={event => setCommandQuery(event.target.value)} /><kbd>Esc</kbd></div>
        <div>{[
          { name: "Add task", run: addTask, disabled: readOnly },
          { name: "Import project", run: () => fileInput.current?.click() },
          { name: "Export OpenGantt file", run: () => exportOpenGantt(project) },
          { name: "Export CSV", run: () => exportCsv(project) },
          { name: "Export Excel workbook", run: () => exportXlsx(project) },
          { name: "Export Microsoft Project XML", run: () => exportProjectXml(project) },
          { name: advancedMode ? "Switch to Simple mode" : "Switch to Advanced mode", run: toggleAdvanced },
          { name: "Undo", run: undo, disabled: !undoStack.current.length || readOnly },
          { name: "Redo", run: redo, disabled: !redoStack.current.length || readOnly }
        ].filter(command => command.name.toLowerCase().includes(commandQuery.toLowerCase())).map(command => <button key={command.name} disabled={command.disabled} onClick={() => { command.run(); setCommandOpen(false); setCommandQuery(""); }}>{command.name}</button>)}</div>
      </section></div>}
      {importWarnings.length > 0 && <div className="modal-backdrop"><section className="cloud-panel" role="dialog" aria-modal="true" aria-label="Import report">
        <header><div><strong>Import completed with warnings</strong><small>Your imported project was saved; review fields that could not be mapped exactly.</small></div></header>
        <ol className="warning-list">{importWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ol>
        <button className="primary" onClick={() => setImportWarnings([])}>Close report</button>
      </section></div>}
      <footer><span>{ordered.length.toLocaleString()} task{ordered.length === 1 ? "" : "s"}</span><span><b className="critical-key" />Critical path</span><span>{readOnly ? "Viewer mode" : "Ready"}</span><span className="license-note">Local-first · AGPL-3.0</span></footer>
    </div>
  );
}
