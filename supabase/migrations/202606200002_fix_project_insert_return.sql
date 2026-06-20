drop policy "members read projects" on public.projects;

create policy "members read projects" on public.projects
for select to authenticated
using (owner_id = auth.uid() or public.project_role_for(id) is not null);
