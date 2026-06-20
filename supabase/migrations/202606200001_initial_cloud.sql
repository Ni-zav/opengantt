create extension if not exists pgcrypto;

create type public.project_role as enum ('viewer', 'editor', 'owner');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 200),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create unique index one_owner_per_project on public.project_members(project_id) where role = 'owner';

create table public.project_documents (
  project_id uuid primary key references public.projects(id) on delete cascade,
  snapshot jsonb not null,
  y_state bytea,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table public.public_share_links (
  project_id uuid primary key references public.projects(id) on delete cascade,
  slug text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1)));
  return new;
end $$;

create trigger create_profile_after_signup after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id, email, display_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data->>'display_name', split_part(coalesce(email, ''), '@', 1))
from auth.users on conflict (id) do nothing;

create or replace function public.add_project_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members(project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger add_owner_after_project after insert on public.projects
for each row execute function public.add_project_owner();

create or replace function public.project_role_for(target_project uuid) returns public.project_role
language sql stable security definer set search_path = public as $$
  select role from public.project_members where project_id = target_project and user_id = auth.uid()
$$;

create or replace function public.shares_project_with(target_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
  )
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger touch_projects before update on public.projects for each row execute function public.touch_updated_at();
create trigger touch_documents before update on public.project_documents for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_documents enable row level security;
alter table public.public_share_links enable row level security;

create policy "profiles visible to project peers" on public.profiles for select to authenticated using (id = auth.uid() or public.shares_project_with(id));
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read projects" on public.projects for select to authenticated using (public.project_role_for(id) is not null);
create policy "users create owned projects" on public.projects for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update projects" on public.projects for update to authenticated using (public.project_role_for(id) = 'owner') with check (owner_id = auth.uid());
create policy "owners delete projects" on public.projects for delete to authenticated using (public.project_role_for(id) = 'owner');

create policy "members read membership" on public.project_members for select to authenticated using (public.project_role_for(project_id) is not null);

create policy "members read documents" on public.project_documents for select to authenticated using (public.project_role_for(project_id) is not null);
create policy "editors create documents" on public.project_documents for insert to authenticated with check (public.project_role_for(project_id) in ('editor', 'owner'));
create policy "editors update documents" on public.project_documents for update to authenticated using (public.project_role_for(project_id) in ('editor', 'owner')) with check (public.project_role_for(project_id) in ('editor', 'owner'));

create policy "owners read share links" on public.public_share_links for select to authenticated using (public.project_role_for(project_id) = 'owner');

create or replace function public.invite_project_member(target_project uuid, member_email text, member_role public.project_role) returns void
language plpgsql security definer set search_path = public as $$
declare target_user uuid;
begin
  if public.project_role_for(target_project) <> 'owner' then raise exception 'Only the owner can invite members'; end if;
  if member_role = 'owner' then raise exception 'Use ownership transfer'; end if;
  select id into target_user from public.profiles where lower(email) = lower(member_email);
  if target_user is null then raise exception 'That user must sign in once before being invited'; end if;
  insert into public.project_members(project_id, user_id, role) values (target_project, target_user, member_role)
  on conflict (project_id, user_id) do update set role = excluded.role where project_members.role <> 'owner';
end $$;

create or replace function public.remove_project_member(target_project uuid, target_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.project_role_for(target_project) <> 'owner' then raise exception 'Only the owner can remove members'; end if;
  if target_user = auth.uid() then raise exception 'Transfer ownership before leaving'; end if;
  delete from public.project_members where project_id = target_project and user_id = target_user and role <> 'owner';
end $$;

create or replace function public.transfer_project_ownership(target_project uuid, new_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.project_role_for(target_project) <> 'owner' then raise exception 'Only the owner can transfer ownership'; end if;
  if not exists(select 1 from public.project_members where project_id = target_project and user_id = new_owner) then raise exception 'New owner must already be a member'; end if;
  update public.project_members set role = 'editor' where project_id = target_project and user_id = auth.uid();
  update public.project_members set role = 'owner' where project_id = target_project and user_id = new_owner;
  update public.projects set owner_id = new_owner where id = target_project;
end $$;

create or replace function public.set_public_share(target_project uuid, should_enable boolean) returns text
language plpgsql security definer set search_path = public as $$
declare result_slug text;
begin
  if public.project_role_for(target_project) <> 'owner' then raise exception 'Only the owner can change sharing'; end if;
  insert into public.public_share_links(project_id, enabled) values (target_project, should_enable)
  on conflict (project_id) do update set enabled = excluded.enabled
  returning slug into result_slug;
  update public.projects set visibility = case when should_enable then 'public' else 'private' end where id = target_project;
  return result_slug;
end $$;

create or replace function public.rename_project(target_project uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.project_role_for(target_project) not in ('editor', 'owner') then raise exception 'Edit access required'; end if;
  if char_length(trim(new_name)) not between 1 and 200 then raise exception 'Project name must be 1 to 200 characters'; end if;
  update public.projects set name = trim(new_name) where id = target_project;
end $$;

create or replace function public.rotate_public_share(target_project uuid) returns text
language plpgsql security definer set search_path = public as $$
declare result_slug text;
begin
  if public.project_role_for(target_project) <> 'owner' then raise exception 'Only the owner can rotate sharing'; end if;
  update public.public_share_links set slug = encode(extensions.gen_random_bytes(18), 'hex'), enabled = true
  where project_id = target_project returning slug into result_slug;
  if result_slug is null then
    insert into public.public_share_links(project_id, enabled) values (target_project, true) returning slug into result_slug;
  end if;
  update public.projects set visibility = 'public' where id = target_project;
  return result_slug;
end $$;

create or replace function public.get_public_project(link_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'snapshot', d.snapshot, 'updatedAt', d.updated_at)
  from public.public_share_links l
  join public.projects p on p.id = l.project_id
  join public.project_documents d on d.project_id = p.id
  where l.slug = link_slug and l.enabled and p.visibility = 'public'
$$;

revoke all on function public.get_public_project(text) from public;
revoke all on function public.project_role_for(uuid) from public;
revoke all on function public.shares_project_with(uuid) from public;
revoke all on function public.invite_project_member(uuid, text, public.project_role) from public;
revoke all on function public.remove_project_member(uuid, uuid) from public;
revoke all on function public.transfer_project_ownership(uuid, uuid) from public;
revoke all on function public.set_public_share(uuid, boolean) from public;
revoke all on function public.rotate_public_share(uuid) from public;
revoke all on function public.rename_project(uuid, text) from public;
grant execute on function public.get_public_project(text) to anon, authenticated;
grant execute on function public.project_role_for(uuid) to authenticated;
grant execute on function public.shares_project_with(uuid) to authenticated;
grant execute on function public.invite_project_member(uuid, text, public.project_role) to authenticated;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_project_ownership(uuid, uuid) to authenticated;
grant execute on function public.set_public_share(uuid, boolean) to authenticated;
grant execute on function public.rotate_public_share(uuid) to authenticated;
grant execute on function public.rename_project(uuid, text) to authenticated;
