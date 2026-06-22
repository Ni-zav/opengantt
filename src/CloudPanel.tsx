import { useEffect, useState } from "react";
import { ArrowClockwise, Cloud, Copy, Crown, Link, LinkBreak, SignIn, SignOut, Trash, UserPlus, Users, X } from "@phosphor-icons/react";
import {
  cloudConfigured, createCloudProject, deleteCloudProject, ensureFreshSession, initializeCloudSession, inviteMember, listCloudProjects, listMembers,
  loadCloudProject, loadPublicProject, removeMember, rotatePublicShare, sendMagicLink, setPublicShare, signOut, transferOwnership,
  type CloudMember, type CloudProject, type CloudSession
} from "./cloud";
import type { Project } from "./model";

interface Props {
  current: Project;
  activeCloud?: CloudProject;
  onOpen(project: Project, cloud: CloudProject): void;
  onSession(session: CloudSession | null): void;
  onDelete(projectId: string): void;
}

export default function CloudPanel({ current, activeCloud, onOpen, onSession, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<CloudSession | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [members, setMembers] = useState<CloudMember[]>([]);
  const [email, setEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("editor");
  const [message, setMessage] = useState("");

  async function refresh(currentSession = session) {
    if (!currentSession) return;
    setProjects(await listCloudProjects(currentSession));
    if (activeCloud?.role === "owner") setMembers(await listMembers(currentSession, activeCloud.id));
  }

  useEffect(() => {
    if (!cloudConfigured) return;
    initializeCloudSession().then(async next => {
      setSession(next); onSession(next);
      if (next) setProjects(await listCloudProjects(next));
    }).catch(error => setMessage(error instanceof Error ? error.message : "Cloud login failed."));
    const slug = new URLSearchParams(location.search).get("share");
    if (slug) loadPublicProject(slug).then(project => onOpen(project, { id: project.id, name: project.name, role: "viewer", visibility: "public", updatedAt: project.updatedAt, shareSlug: slug })).catch(error => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => ensureFreshSession(session).then(next => {
      if (next.accessToken !== session.accessToken) { setSession(next); onSession(next); }
    }).catch(error => setMessage(error instanceof Error ? error.message : "Session refresh failed.")), 30_000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (session && activeCloud?.role === "owner") listMembers(session, activeCloud.id).then(setMembers).catch(() => setMembers([]));
    else setMembers([]);
  }, [session, activeCloud?.id, activeCloud?.role]);

  async function run(action: () => Promise<void>, success?: string) {
    setMessage("Working…");
    try { await action(); setMessage(success ?? "Done"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cloud action failed."); }
  }

  if (!cloudConfigured) return <button className="cloud-trigger" title="Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud projects" disabled><Cloud size={16} /><span>Cloud setup</span></button>;

  return <>
    <button className="cloud-trigger" onClick={() => setOpen(true)}>{session ? <Cloud size={16} weight="fill" /> : <SignIn size={16} />}<span>{session ? "Cloud" : "Sign in"}</span></button>
    {open && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="cloud-panel" role="dialog" aria-modal="true" aria-label="Cloud projects">
        <header><div className="cloud-panel-title"><span><Cloud size={19} weight="fill" /></span><div><strong>OpenGantt Cloud</strong><small>{session?.user.email ?? "Save and share projects"}</small></div></div><button className="icon-button" aria-label="Close cloud panel" onClick={() => setOpen(false)}><X size={17} /></button></header>
        {!session ? <form onSubmit={event => { event.preventDefault(); run(() => sendMagicLink(email), "Check your email for the sign-in link."); }}>
          <label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <button className="primary" type="submit"><SignIn size={16} />Email me a sign-in link</button>
        </form> : <>
          <div className="cloud-actions"><button className="primary" onClick={() => run(async () => {
            const cloud = await createCloudProject(session, current);
            const snapshot = { ...current, id: cloud.id };
            onOpen(snapshot, cloud); await refresh(session);
          }, "Copied to cloud.")}><Copy size={16} />Copy current project</button><button onClick={() => run(() => refresh(session))}><ArrowClockwise size={16} />Refresh</button></div>
          <div className="cloud-list">{projects.map(item => <button key={item.id} className={activeCloud?.id === item.id ? "active" : ""} onClick={() => run(async () => { onOpen(await loadCloudProject(session, item.id), item); setOpen(false); })}><span>{item.name}</span><small>{item.role} · {item.visibility}</small></button>)}</div>
          {activeCloud?.role === "owner" && <div className="sharing-section">
            <h3><Link size={15} />Sharing</h3>
            <div className="cloud-actions"><button onClick={() => run(async () => {
              const slug = await setPublicShare(session, activeCloud.id, true);
              await navigator.clipboard.writeText(`${location.origin}${location.pathname}?share=${slug}`);
            }, "Public viewer link copied.")}><Copy size={15} />Copy viewer link</button><button onClick={() => run(async () => {
              const slug = await rotatePublicShare(session, activeCloud.id);
              await navigator.clipboard.writeText(`${location.origin}${location.pathname}?share=${slug}`);
            }, "Old link revoked; new link copied.")}><ArrowClockwise size={15} />Rotate</button><button onClick={() => run(() => setPublicShare(session, activeCloud.id, false).then(() => undefined), "Public link disabled.")}><LinkBreak size={15} />Disable</button></div>
            <h3><Users size={15} />Members</h3>
            <form className="invite-form" onSubmit={event => { event.preventDefault(); run(async () => { await inviteMember(session, activeCloud.id, inviteEmail, inviteRole); setInviteEmail(""); await refresh(session); }, "Member added."); }}>
              <input required aria-label="Member email" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="member@example.com" />
              <select aria-label="Member role" value={inviteRole} onChange={event => setInviteRole(event.target.value as "viewer" | "editor")}><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
              <button type="submit"><UserPlus size={15} />Add</button>
            </form>
            <div className="member-list">{members.map(member => <div key={member.userId}><span>{member.displayName || member.email}<small>{member.role}</small></span>{member.role !== "owner" && <span><button onClick={() => run(() => transferOwnership(session, activeCloud.id, member.userId), "Ownership transferred.")}><Crown size={14} />Make owner</button><button className="danger" onClick={() => run(async () => { await removeMember(session, activeCloud.id, member.userId); await refresh(session); })}><Trash size={14} />Remove</button></span>}</div>)}</div>
            <h3>Danger zone</h3>
            <button className="danger" onClick={() => { if (confirm(`Permanently delete ${activeCloud.name}? This cannot be undone.`)) run(async () => { await deleteCloudProject(session, activeCloud.id); onDelete(activeCloud.id); await refresh(session); }, "Project deleted."); }}><Trash size={15} />Delete cloud project</button>
          </div>}
          <button onClick={() => run(async () => { await signOut(session); setSession(null); onSession(null); setProjects([]); }, "Signed out.")}><SignOut size={15} />Sign out</button>
        </>}
        {message && <p className="cloud-message" role="status">{message}</p>}
      </section>
    </div>}
  </>;
}
