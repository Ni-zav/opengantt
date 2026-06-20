import { afterEach, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";

const providers: HocuspocusProvider[] = [];
const servers: Server[] = [];

afterEach(async () => {
  providers.splice(0).forEach(provider => provider.destroy());
  await Promise.all(servers.splice(0).map(server => server.destroy()));
});

const waitFor = async (condition: () => boolean, timeout = 5_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for collaboration state.");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

describe("Hocuspocus room", () => {
  it("synchronizes 25 clients and enforces a read-only viewer", async () => {
    const server = new Server<{ role: "viewer" | "editor" }>({
      port: 0, address: "127.0.0.1", quiet: true, debounce: 10,
      async onAuthenticate({ token, connectionConfig }) {
        const role = token === "viewer" ? "viewer" : "editor";
        connectionConfig.readOnly = role === "viewer";
        return { role };
      }
    });
    servers.push(server); await server.listen(0);
    const name = "11111111-1111-4111-8111-111111111111";
    const connect = (token: string) => new Promise<{ provider: HocuspocusProvider; doc: Y.Doc }>((resolve, reject) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL, name, document: doc, token,
        onSynced: () => resolve({ provider, doc }),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason))
      });
      providers.push(provider);
    });
    const editors = await Promise.all(Array.from({ length: 25 }, () => connect("editor")));
    editors[0].doc.getMap("load-test").set("shared", "yes");
    await waitFor(() => editors.every(client => client.doc.getMap("load-test").get("shared") === "yes"));
    expect(server.hocuspocus.getConnectionsCount()).toBe(25);

    const viewer = await connect("viewer");
    viewer.doc.getMap("load-test").set("viewer-only", "blocked");
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(editors.every(client => client.doc.getMap("load-test").has("viewer-only") === false)).toBe(true);
  }, 15_000);
});
