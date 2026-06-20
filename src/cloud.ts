import { normalizeProject, type Project } from "./model";

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const SESSION_KEY = "opengantt.cloud.session";

export const cloudConfigured = Boolean(url && apiKey);

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export interface CloudProject {
  id: string;
  name: string;
  role: "viewer" | "editor" | "owner";
  visibility: "private" | "public";
  updatedAt: string;
  shareSlug?: string;
}

export interface CloudMember {
  userId: string;
  role: CloudProject["role"];
  email: string;
  displayName: string | null;
}

function saveSession(session: CloudSession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!cloudConfigured) throw new Error("Cloud is not configured.");
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error_description?: string; hint?: string };
    throw new Error(body.message || body.error_description || body.hint || `Cloud request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

async function userFor(accessToken: string) {
  return request<{ id: string; email?: string }>("/auth/v1/user", {}, accessToken);
}

export async function initializeCloudSession(): Promise<CloudSession | null> {
  const callback = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (callback.has("access_token")) {
    const accessToken = callback.get("access_token")!;
    const user = await userFor(accessToken);
    const session: CloudSession = {
      accessToken,
      refreshToken: callback.get("refresh_token") ?? "",
      expiresAt: Date.now() + Number(callback.get("expires_in") ?? 3600) * 1000,
      user: { id: user.id, email: user.email ?? "" }
    };
    saveSession(session);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return session;
  }
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  try {
    const session = await ensureFreshSession(JSON.parse(saved) as CloudSession);
    await userFor(session.accessToken);
    return session;
  } catch {
    saveSession(null);
    return null;
  }
}

export async function ensureFreshSession(session: CloudSession): Promise<CloudSession> {
  if (session.expiresAt - Date.now() >= 60_000 || !session.refreshToken) return session;
  const refreshed = await request<{ access_token: string; refresh_token: string; expires_in: number; user: { id: string; email?: string } }>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST", body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  const next = { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: Date.now() + refreshed.expires_in * 1000, user: { id: refreshed.user.id, email: refreshed.user.email ?? "" } };
  saveSession(next);
  return next;
}

export async function sendMagicLink(email: string): Promise<void> {
  await request("/auth/v1/otp", { method: "POST", body: JSON.stringify({ email, create_user: true, email_redirect_to: location.origin }) });
}

export async function signOut(session: CloudSession): Promise<void> {
  await request("/auth/v1/logout", { method: "POST" }, session.accessToken).catch(() => undefined);
  saveSession(null);
}

export async function listCloudProjects(session: CloudSession): Promise<CloudProject[]> {
  const rows = await request<Array<{ role: CloudProject["role"]; projects: { id: string; name: string; visibility: CloudProject["visibility"]; updated_at: string } }>>(
    `/rest/v1/project_members?select=role,projects(id,name,visibility,updated_at)&user_id=eq.${session.user.id}`, {}, session.accessToken
  );
  return rows.map(row => ({ id: row.projects.id, name: row.projects.name, role: row.role, visibility: row.projects.visibility, updatedAt: row.projects.updated_at }));
}

export async function createCloudProject(session: CloudSession, source: Project): Promise<CloudProject> {
  const [created] = await request<Array<{ id: string; name: string; visibility: "private"; updated_at: string }>>("/rest/v1/projects?select=id,name,visibility,updated_at", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ owner_id: session.user.id, name: source.name })
  }, session.accessToken);
  const snapshot = { ...source, id: created.id };
  const [Y, yProject] = await Promise.all([import("yjs"), import("./yProject")]);
  const doc = new Y.Doc(); yProject.applyProjectToY(doc, snapshot, yProject.INITIAL_ORIGIN);
  const yState = `\\x${[...Y.encodeStateAsUpdate(doc)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  doc.destroy();
  await request("/rest/v1/project_documents", { method: "POST", body: JSON.stringify({ project_id: created.id, snapshot, y_state: yState }) }, session.accessToken);
  return { id: created.id, name: created.name, role: "owner", visibility: created.visibility, updatedAt: created.updated_at };
}

export async function loadCloudProject(session: CloudSession, id: string): Promise<Project> {
  const rows = await request<Array<{ snapshot: unknown }>>(`/rest/v1/project_documents?select=snapshot&project_id=eq.${id}`, {}, session.accessToken);
  if (!rows[0]) throw new Error("Cloud project was not found.");
  return normalizeProject(rows[0].snapshot);
}

export async function saveCloudProject(session: CloudSession, project: Project): Promise<void> {
  await Promise.all([
    request("/rest/v1/project_documents?on_conflict=project_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ project_id: project.id, snapshot: project, revision: Date.now() })
    }, session.accessToken),
    request("/rest/v1/rpc/rename_project", { method: "POST", body: JSON.stringify({ target_project: project.id, new_name: project.name }) }, session.accessToken)
  ]);
}

export async function setPublicShare(session: CloudSession, projectId: string, enabled: boolean): Promise<string> {
  return request<string>("/rest/v1/rpc/set_public_share", { method: "POST", body: JSON.stringify({ target_project: projectId, should_enable: enabled }) }, session.accessToken);
}

export async function rotatePublicShare(session: CloudSession, projectId: string): Promise<string> {
  return request<string>("/rest/v1/rpc/rotate_public_share", { method: "POST", body: JSON.stringify({ target_project: projectId }) }, session.accessToken);
}

export async function deleteCloudProject(session: CloudSession, projectId: string): Promise<void> {
  await request(`/rest/v1/projects?id=eq.${projectId}`, { method: "DELETE" }, session.accessToken);
}

export async function loadPublicProject(slug: string): Promise<Project> {
  const result = await request<{ snapshot: unknown } | null>("/rest/v1/rpc/get_public_project", { method: "POST", body: JSON.stringify({ link_slug: slug }) });
  if (!result) throw new Error("This public link is unavailable.");
  return normalizeProject(result.snapshot);
}

export async function listMembers(session: CloudSession, projectId: string): Promise<CloudMember[]> {
  const rows = await request<Array<{ user_id: string; role: CloudProject["role"]; profiles: { email: string; display_name: string | null } }>>(
    `/rest/v1/project_members?select=user_id,role,profiles(email,display_name)&project_id=eq.${projectId}`, {}, session.accessToken
  );
  return rows.map(row => ({ userId: row.user_id, role: row.role, email: row.profiles.email, displayName: row.profiles.display_name }));
}

export async function inviteMember(session: CloudSession, projectId: string, email: string, role: "viewer" | "editor") {
  await request("/rest/v1/rpc/invite_project_member", { method: "POST", body: JSON.stringify({ target_project: projectId, member_email: email, member_role: role }) }, session.accessToken);
}

export async function removeMember(session: CloudSession, projectId: string, userId: string) {
  await request("/rest/v1/rpc/remove_project_member", { method: "POST", body: JSON.stringify({ target_project: projectId, target_user: userId }) }, session.accessToken);
}

export async function transferOwnership(session: CloudSession, projectId: string, userId: string) {
  await request("/rest/v1/rpc/transfer_project_ownership", { method: "POST", body: JSON.stringify({ target_project: projectId, new_owner: userId }) }, session.accessToken);
}
