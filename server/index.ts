import { Server } from "@hocuspocus/server";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Y from "yjs";

interface Context { name: string; color: string }

const port = Number(process.env.COLLAB_PORT ?? 1234);
const monitoringPort = Number(process.env.COLLAB_MONITORING_PORT ?? port + 1);
const dataDir = process.env.COLLAB_DATA_DIR ?? "collab-data";
const sharedToken = process.env.COLLAB_TOKEN ?? "";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
const metrics = { connections: 0, authRejected: 0, stores: 0, storeErrors: 0 };

const log = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));

function assertDocumentName(name: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name)) throw new Error("Invalid document name.");
}

const documentPath = (name: string) => join(dataDir, `${name}.bin`);

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
  async onAuthenticate({ token, documentName, requestHeaders }) {
    try {
      assertDocumentName(documentName);
      const origin = requestHeaders.get("origin");
      if (allowedOrigins.length && (!origin || !allowedOrigins.includes(origin))) throw new Error("Origin is not allowed.");
      if (sharedToken && token !== sharedToken) throw new Error("Collaboration token is invalid.");
      return { name: "Self-hosted user", color: "#147d64" };
    } catch (error) {
      metrics.authRejected++;
      log("auth_rejected", { documentId: documentName, reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
  },
  async onLoadDocument({ document, documentName }) {
    assertDocumentName(documentName);
    try {
      Y.applyUpdate(document, await readFile(documentPath(documentName)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return document;
  },
  async onStoreDocument({ document, documentName }) {
    try {
      assertDocumentName(documentName);
      await mkdir(dataDir, { recursive: true });
      await writeFile(documentPath(documentName), Y.encodeStateAsUpdate(document));
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
      state.user = context;
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
log("collaboration_started", { port, monitoringPort, dataDir });
