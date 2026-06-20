import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const { COLLAB_TEST_URL: url, COLLAB_TEST_PROJECT_ID: name, COLLAB_TEST_EDITOR_TOKEN: editorToken, COLLAB_TEST_VIEWER_TOKEN: viewerToken } = process.env;
if (!url || !name || !editorToken || !viewerToken) throw new Error("Live collaboration test environment is incomplete.");

const providers = [];
const waitFor = async (condition, timeout = 8_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for live collaboration state.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const connect = token => new Promise((resolve, reject) => {
  const document = new Y.Doc();
  let settled = false;
  const timer = setTimeout(() => { if (!settled) reject(new Error("Timed out authenticating and syncing a live client.")); }, 10_000);
  const provider = new HocuspocusProvider({
    url, name, token, document,
    onSynced: () => { settled = true; clearTimeout(timer); resolve({ provider, document }); },
    onAuthenticationFailed: ({ reason }) => { settled = true; clearTimeout(timer); reject(new Error(reason)); },
    onClose: () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("Live collaboration connection closed before sync.")); } }
  });
  providers.push(provider);
});

try {
  const editor = await connect(editorToken);
  const viewer = await connect(viewerToken);
  editor.document.getMap("project").set("name", "Live collaboration verified");
  await waitFor(() => viewer.document.getMap("project").get("name") === "Live collaboration verified");
  viewer.document.getMap("project").set("name", "Viewer mutation must not propagate");
  await new Promise(resolve => setTimeout(resolve, 300));
  if (editor.document.getMap("project").get("name") !== "Live collaboration verified") throw new Error("Viewer mutation reached the editor.");
  console.log(JSON.stringify({ editorSync: true, viewerSync: true, viewerWriteBlocked: true }));
} finally {
  providers.forEach(provider => provider.destroy());
}
