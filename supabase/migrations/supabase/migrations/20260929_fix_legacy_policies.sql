do $$
declare
  table_name text;
  existing_policy record;
begin
  foreach table_name in array array[
    'notes',
    'memo_notes',
    'memo_folders',
    'planning_templates'
  ]
  loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I enable row level security',
      table_name
    );

    for existing_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        existing_policy.policyname,
        table_name
      );
    end loop;

    execute format(
      'create policy collaboration_select
       on public.%I
       for select
       to authenticated
       using (
         owner_id = auth.uid()
         or public.is_space_member(space_id, auth.uid())
       )',
      table_name
    );

    execute format(
      'create policy collaboration_insert
       on public.%I
       for insert
       to authenticated
       with check (
         owner_id = auth.uid()
         and (
           space_id is null
           or public.is_space_member(space_id, auth.uid())
         )
       )',
      table_name
    );

    execute format(
      'create policy collaboration_update
       on public.%I
       for update
       to authenticated
       using (
         owner_id = auth.uid()
         or public.is_space_member(space_id, auth.uid())
       )
       with check (
         owner_id = auth.uid()
         or public.is_space_member(space_id, auth.uid())
       )',
      table_name
    );

    execute format(
      'create policy collaboration_delete
       on public.%I
       for delete
       to authenticated
       using (
         owner_id = auth.uid()
         or public.is_space_member(space_id, auth.uid())
       )',
      table_name
    );

    execute format(
      'revoke all on public.%I from anon',
      table_name
    );

    execute format(
      'grant select, insert, update, delete
       on public.%I to authenticated',
      table_name
    );
  end loop;
end $$;

alter table public.subscriptions enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
  loop
    execute format(
      'drop policy if exists %I on public.subscriptions',
      existing_policy.policyname
    );
  end loop;
end $$;

create policy subscriptions_select_self
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

create policy subscriptions_insert_self
on public.subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

create policy subscriptions_update_self
on public.subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy subscriptions_delete_self
on public.subscriptions
for delete
to authenticated
using (user_id = auth.uid());

revoke all on public.subscriptions from anon;

grant select, insert, update, delete
on public.subscriptions to authenticated;