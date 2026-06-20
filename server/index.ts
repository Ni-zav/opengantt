import { Server } from "@hocuspocus/server";
import { createServer } from "node:http";
import * as Y from "yjs";
import { applyProjectToY, projectFromY } from "../src/yProject";
import { normalizeProject } from "../src/model";

type Role = "viewer" | "editor" | "owner";
interface Context { userId: string | null; name: string; role: Role; public: boolean }

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const port = Number(process.env.COLLAB_PORT ?? 1234);
const monitoringPort = Number(process.env.COLLAB_MONITORING_PORT ?? port + 1);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
const metrics = { connections: 0, authRejected: 0, stores: 0, storeErrors: 0 };

if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const log = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));

async function supabase<T>(path: string, options: RequestInit = {}, bearer = serviceKey): Promise<T> {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: { apikey: serviceKey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...options.headers }
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

function assertDocumentName(name: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name)) throw new Error("Invalid document name.");
}

async function authenticate(token: string, documentName: string): Promise<Context> {
  assertDocumentName(documentName);
  if (token.startsWith("public:")) {
    const slug = token.slice(7);
    if (!/^[0-9a-f]{36}$/i.test(slug)) throw new Error("Invalid public token.");
    const shared = await supabase<{ id: string } | null>("/rest/v1/rpc/get_public_project", { method: "POST", body: JSON.stringify({ link_slug: slug }) });
    if (!shared || shared.id !== documentName) throw new Error("Public link is unavailable.");
    return { userId: null, name: "Guest viewer", role: "viewer", public: true };
  }
  const user = await supabase<{ id: string; email?: string }>("/auth/v1/user", {}, token);
  const role = await supabase<Role | null>("/rest/v1/rpc/project_role_for", { method: "POST", body: JSON.stringify({ target_project: documentName }) }, token);
  if (!role) throw new Error("Project access denied.");
  return { userId: user.id, name: user.email ?? "Member", role, public: false };
}

const decodeBytea = (value: string) => Uint8Array.from(Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex"));
const encodeBytea = (value: Uint8Array) => `\\x${Buffer.from(value).toString("hex")}`;

const server = new Server<Context>({
  port,
  address: "0.0.0.0",
  quiet: true,
  timeout: 30_000,
  debounce: 2_000,
  maxDebounce: 10_000,
  unloadImmediately: false,
  maxUnauthenticatedQueueSize: 8_388_608,
  maxUnauthenticatedQueueMessages: 500,
  maxPendingDocuments: 5,
  websocketOptions: { maxPayload: 8_388_608 },
  async onAuthenticate({ token, documentName, connectionConfig, requestHeaders }) {
    try {
      const origin = requestHeaders.get("origin");
      if (allowedOrigins.length && (!origin || !allowedOrigins.includes(origin))) throw new Error("Origin is not allowed.");
      const context = await authenticate(token, documentName);
      connectionConfig.readOnly = context.role === "viewer";
      log("auth_accepted", { documentId: documentName, role: context.role });
      return context;
    } catch (error) {
      metrics.authRejected++;
      log("auth_rejected", { documentId: documentName, reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
  },
  async onLoadDocument({ document, documentName }) {
    try {
      assertDocumentName(documentName);
      const rows = await supabase<Array<{ y_state: string | null; snapshot: unknown }>>(`/rest/v1/project_documents?select=y_state,snapshot&project_id=eq.${encodeURIComponent(documentName)}`);
      if (!rows[0]) throw new Error("Project document not found.");
      if (rows[0].y_state) Y.applyUpdate(document, decodeBytea(rows[0].y_state));
      else if (rows[0].snapshot) applyProjectToY(document, normalizeProject(rows[0].snapshot), "server-initial");
      return document;
    } catch (error) {
      log("load_failed", { documentId: documentName, reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
  },
  async onStoreDocument({ document, documentName }) {
    try {
      const body: Record<string, unknown> = { project_id: documentName, y_state: encodeBytea(Y.encodeStateAsUpdate(document)), revision: Date.now() };
      try { body.snapshot = projectFromY(document); } catch { /* Persist CRDT state while concurrent edits temporarily violate validation. */ }
      await supabase("/rest/v1/project_documents?on_conflict=project_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(body)
      });
      metrics.stores++;
    } catch (error) {
      metrics.storeErrors++;
      log("store_failed", { documentId: documentName, reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
  },
  async beforeHandleAwareness({ context, states }) {
    if (!context) return;
    for (const state of states.values()) {
      const requestedColor = typeof state.user?.color === "string" ? state.user.color : "";
      const color = /^(#[0-9a-f]{6}|hsl\([0-9]{1,3} 55% 45%\))$/i.test(requestedColor) ? requestedColor : "#656c63";
      state.user = { id: context.userId, name: context.name, color };
      if (state.selection && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.selection.taskId ?? "")) delete state.selection;
    }
  },
  async onConnect() { metrics.connections++; },
  async onDisconnect() { metrics.connections = Math.max(0, metrics.connections - 1); }
});

await server.listen();
createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ status: "ok" }));
  } else if (request.url === "/metrics") {
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    response.end(`opengantt_collab_connections ${metrics.connections}\nopengantt_collab_auth_rejected_total ${metrics.authRejected}\nopengantt_collab_stores_total ${metrics.stores}\nopengantt_collab_store_errors_total ${metrics.storeErrors}\n`);
  } else { response.writeHead(404); response.end(); }
}).listen(monitoringPort, "0.0.0.0");
log("collaboration_started", { port, monitoringPort });
