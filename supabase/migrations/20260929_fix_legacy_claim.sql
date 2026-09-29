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
    new.owner_id := case
      when old.owner_id is null then coalesce(new.owner_id, auth.uid())
      else old.owner_id
    end;

    new.created_by := case
      when old.created_by is null then coalesce(new.created_by, auth.uid())
      else old.created_by
    end;

    new.updated_by := coalesce(auth.uid(), old.updated_by);

    if to_jsonb(new) ? 'updated_at' then
      new := jsonb_populate_record(
        new,
        jsonb_build_object('updated_at', now())
      );
    end if;

    if to_jsonb(new) ? 'version' then
      new := jsonb_populate_record(
        new,
        jsonb_build_object(
          'version',
          coalesce((to_jsonb(old)->>'version')::integer, 0) + 1
        )
      );
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  target_user uuid;
  table_name text;
begin
  select users.id into target_user
  from auth.users users
  join public.app_private_config config
    on lower(users.email) = lower(config.legacy_owner_email)
  where config.singleton = true
  limit 1;

  if target_user is null then
    raise exception
      'Compte introuvable : vérifie legacy_owner_email dans app_private_config.';
  end if;

  foreach table_name in array array[
    'notes',
    'memo_notes',
    'memo_folders',
    'planning_templates'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'update public.%I
         set owner_id = $1,
             created_by = coalesce(created_by, $1),
             updated_by = $1
         where owner_id is null',
        table_name
      ) using target_user;
    end if;
  end loop;

  update public.subscriptions
  set user_id = target_user,
      updated_at = now()
  where user_id is null;

  update public.app_private_config
  set legacy_claimed_by = target_user,
      legacy_claimed_at = coalesce(legacy_claimed_at, now())
  where singleton = true;
end $$;