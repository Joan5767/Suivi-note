-- Comptes, espaces partagés et sécurité multi-utilisateur.
--
-- AVANT D'EXÉCUTER CE FICHIER dans Supabase > SQL Editor :
-- remplace exactement REMPLACE_PAR_TON_EMAIL par l'adresse e-mail de ton
-- premier compte. Ce compte récupérera les notes, tâches, plannings et
-- abonnements push qui existaient avant l'ajout des comptes.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Utilisateur',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.collaboration_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  space_id uuid references public.shared_spaces(id) on delete cascade,
  notification_type text not null default 'shared_item',
  title text not null,
  body text not null default '',
  entity_type text check (entity_type in ('note', 'memo', 'planning')),
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_notifications_recipient_idx
  on public.collaboration_notifications(recipient_id, created_at desc);
create index if not exists space_members_user_idx
  on public.space_members(user_id, joined_at);

-- Cette ligne protège la récupération des anciennes données : seul le compte
-- correspondant à l'e-mail indiqué pourra les réclamer.
create table if not exists public.app_private_config (
  singleton boolean primary key default true check (singleton),
  legacy_owner_email text,
  legacy_claimed_by uuid references auth.users(id) on delete set null,
  legacy_claimed_at timestamptz
);

insert into public.app_private_config(singleton, legacy_owner_email)
values (true, lower('joan.windstein@gmail.com'))
on conflict (singleton) do update
set legacy_owner_email = excluded.legacy_owner_email
where public.app_private_config.legacy_claimed_by is null;

revoke all on public.app_private_config from anon, authenticated;

-- Colonnes communes de propriété et de partage. Elles restent nullable le
-- temps que le propriétaire historique se connecte et récupère ses données.
alter table if exists public.notes
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists space_id uuid references public.shared_spaces(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.memo_notes
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists space_id uuid references public.shared_spaces(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table if exists public.memo_folders
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists space_id uuid references public.shared_spaces(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table if exists public.planning_templates
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists space_id uuid references public.shared_spaces(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;

alter table if exists public.subscriptions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists device_label text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists notes_owner_idx on public.notes(owner_id);
create index if not exists notes_space_idx on public.notes(space_id);
create index if not exists memo_notes_owner_idx on public.memo_notes(owner_id);
create index if not exists memo_notes_space_idx on public.memo_notes(space_id);
create index if not exists planning_templates_owner_idx on public.planning_templates(owner_id);
create index if not exists planning_templates_space_idx on public.planning_templates(space_id);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Utilisateur')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user_profile();

-- Ajoute aussi un profil aux comptes éventuellement créés avant la migration.
insert into public.profiles(id, display_name)
select id, coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), split_part(email, '@', 1), 'Utilisateur')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_space_member(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_space_id is not null and p_user_id is not null and exists (
    select 1 from public.space_members
    where space_id = p_space_id and user_id = p_user_id
  );
$$;

create or replace function public.is_space_owner(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_space_id is not null and p_user_id is not null and exists (
    select 1 from public.space_members
    where space_id = p_space_id and user_id = p_user_id and role = 'owner'
  );
$$;

create or replace function public.shares_space_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_other_user_id = auth.uid() or exists (
    select 1
    from public.space_members mine
    join public.space_members theirs on theirs.space_id = mine.space_id
    where mine.user_id = auth.uid() and theirs.user_id = p_other_user_id
  );
$$;

revoke all on function public.is_space_member(uuid, uuid) from public;
revoke all on function public.is_space_owner(uuid, uuid) from public;
revoke all on function public.shares_space_with(uuid) from public;
grant execute on function public.is_space_member(uuid, uuid) to authenticated;
grant execute on function public.is_space_owner(uuid, uuid) to authenticated;
grant execute on function public.shares_space_with(uuid) to authenticated;

create or replace function public.set_collaboration_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  else
    new.owner_id := old.owner_id;
    new.created_by := old.created_by;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    if to_jsonb(new) ? 'updated_at' then
      new := jsonb_populate_record(new, jsonb_build_object('updated_at', now()));
    end if;
    if to_jsonb(new) ? 'version' then
      new := jsonb_populate_record(new, jsonb_build_object('version', coalesce((to_jsonb(old)->>'version')::integer, 0) + 1));
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['notes', 'memo_notes', 'memo_folders', 'planning_templates']
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists collaboration_ownership_trigger on public.%I', table_name);
      execute format(
        'create trigger collaboration_ownership_trigger before insert or update on public.%I for each row execute function public.set_collaboration_ownership()',
        table_name
      );
    end if;
  end loop;
end $$;

create or replace function public.create_shared_space(p_name text default 'Notre espace')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_space_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Nom d''espace invalide';
  end if;

  insert into public.shared_spaces(name, owner_id)
  values (trim(p_name), auth.uid())
  returning id into new_space_id;

  insert into public.space_members(space_id, user_id, role)
  values (new_space_id, auth.uid(), 'owner');

  return new_space_id;
end;
$$;

create or replace function public.create_space_invite(p_space_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_code text;
begin
  if not public.is_space_member(p_space_id, auth.uid()) then
    raise exception 'Accès refusé';
  end if;

  loop
    invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.space_invites(space_id, code, created_by)
      values (p_space_id, invite_code, auth.uid());
      exit;
    exception when unique_violation then
      -- Génère simplement un autre code.
    end;
  end loop;

  return invite_code;
end;
$$;

create or replace function public.accept_space_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.space_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into invite_row
  from public.space_invites
  where code = upper(trim(p_code))
    and accepted_at is null
    and expires_at > now()
  for update;

  if invite_row.id is null then
    raise exception 'Code invalide ou expiré';
  end if;

  insert into public.space_members(space_id, user_id, role)
  values (invite_row.space_id, auth.uid(), 'editor')
  on conflict (space_id, user_id) do nothing;

  update public.space_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invite_row.id;

  return invite_row.space_id;
end;
$$;

create or replace function public.claim_legacy_data()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  configured_email text;
  current_email text;
  already_claimed uuid;
begin
  if auth.uid() is null then return false; end if;

  select legacy_owner_email, legacy_claimed_by
    into configured_email, already_claimed
  from public.app_private_config
  where singleton = true
  for update;

  select lower(email) into current_email from auth.users where id = auth.uid();

  if configured_email is null
     or configured_email = 'remplace_par_ton_email'
     or current_email is distinct from lower(configured_email) then
    return false;
  end if;

  if already_claimed is not null and already_claimed <> auth.uid() then
    return false;
  end if;

  update public.notes set owner_id = auth.uid(), created_by = auth.uid(), updated_by = auth.uid()
    where owner_id is null;
  update public.memo_notes set owner_id = auth.uid(), created_by = auth.uid(), updated_by = auth.uid()
    where owner_id is null;
  if to_regclass('public.memo_folders') is not null then
    update public.memo_folders set owner_id = auth.uid(), created_by = auth.uid(), updated_by = auth.uid()
      where owner_id is null;
  end if;
  update public.planning_templates set owner_id = auth.uid(), created_by = auth.uid(), updated_by = auth.uid()
    where owner_id is null;
  update public.subscriptions set user_id = auth.uid(), updated_at = now()
    where user_id is null;

  update public.app_private_config
  set legacy_claimed_by = auth.uid(), legacy_claimed_at = now()
  where singleton = true;

  return true;
end;
$$;

revoke all on function public.create_shared_space(text) from public, anon;
revoke all on function public.create_space_invite(uuid) from public, anon;
revoke all on function public.accept_space_invite(text) from public, anon;
revoke all on function public.claim_legacy_data() from public, anon;
grant execute on function public.create_shared_space(text) to authenticated;
grant execute on function public.create_space_invite(uuid) to authenticated;
grant execute on function public.accept_space_invite(text) to authenticated;
grant execute on function public.claim_legacy_data() to authenticated;

alter table public.profiles enable row level security;
alter table public.shared_spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.collaboration_notifications enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.shares_space_with(id));
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
with check (id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists shared_spaces_select_member on public.shared_spaces;
create policy shared_spaces_select_member on public.shared_spaces for select to authenticated
using (public.is_space_member(id, auth.uid()));
drop policy if exists shared_spaces_update_owner on public.shared_spaces;
create policy shared_spaces_update_owner on public.shared_spaces for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists shared_spaces_delete_owner on public.shared_spaces;
create policy shared_spaces_delete_owner on public.shared_spaces for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists space_members_select_member on public.space_members;
create policy space_members_select_member on public.space_members for select to authenticated
using (public.is_space_member(space_id, auth.uid()));
drop policy if exists space_members_delete_owner_or_self on public.space_members;
create policy space_members_delete_owner_or_self on public.space_members for delete to authenticated
using (user_id = auth.uid() or public.is_space_owner(space_id, auth.uid()));

drop policy if exists notifications_select_recipient on public.collaboration_notifications;
create policy notifications_select_recipient on public.collaboration_notifications for select to authenticated
using (recipient_id = auth.uid());
drop policy if exists notifications_update_recipient on public.collaboration_notifications;
create policy notifications_update_recipient on public.collaboration_notifications for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists notifications_delete_recipient on public.collaboration_notifications;
create policy notifications_delete_recipient on public.collaboration_notifications for delete to authenticated
using (recipient_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array['notes', 'memo_notes', 'memo_folders', 'planning_templates']
  loop
    if to_regclass('public.' || table_name) is null then continue; end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists collaboration_select on public.%I', table_name);
    execute format(
      'create policy collaboration_select on public.%I for select to authenticated using (owner_id = auth.uid() or public.is_space_member(space_id, auth.uid()))',
      table_name
    );
    execute format('drop policy if exists collaboration_insert on public.%I', table_name);
    execute format(
      'create policy collaboration_insert on public.%I for insert to authenticated with check (owner_id = auth.uid() and (space_id is null or public.is_space_member(space_id, auth.uid())))',
      table_name
    );
    execute format('drop policy if exists collaboration_update on public.%I', table_name);
    execute format(
      'create policy collaboration_update on public.%I for update to authenticated using (owner_id = auth.uid() or public.is_space_member(space_id, auth.uid())) with check (owner_id = auth.uid() or public.is_space_member(space_id, auth.uid()))',
      table_name
    );
    execute format('drop policy if exists collaboration_delete on public.%I', table_name);
    execute format(
      'create policy collaboration_delete on public.%I for delete to authenticated using (owner_id = auth.uid() or public.is_space_member(space_id, auth.uid()))',
      table_name
    );
  end loop;
end $$;

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_select_self on public.subscriptions;
create policy subscriptions_select_self on public.subscriptions for select to authenticated
using (user_id = auth.uid());
drop policy if exists subscriptions_insert_self on public.subscriptions;
create policy subscriptions_insert_self on public.subscriptions for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists subscriptions_update_self on public.subscriptions;
create policy subscriptions_update_self on public.subscriptions for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists subscriptions_delete_self on public.subscriptions;
create policy subscriptions_delete_self on public.subscriptions for delete to authenticated
using (user_id = auth.uid());

grant select, insert, update on public.profiles to authenticated;
grant select, update, delete on public.shared_spaces to authenticated;
grant select, delete on public.space_members to authenticated;
grant select, update, delete on public.collaboration_notifications to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['notes', 'memo_notes', 'memo_folders', 'planning_templates', 'subscriptions']
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    end if;
  end loop;
end $$;

-- Active les mises à jour temps réel, sans échouer si une table y figure déjà.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['notes', 'memo_notes', 'planning_templates', 'collaboration_notifications']
  loop
    if to_regclass('public.' || table_name) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
       ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
