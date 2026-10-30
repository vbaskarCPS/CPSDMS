-- Planner: a second person (Rosh) and a shared household for money.
--
-- Every planner user keeps their own docs, except the money kinds, which belong to the household:
-- planner_users.household_id points at the user whose rows hold the shared docs (Vijay's). The
-- planner_get / planner_put / planner_put_many functions swap in the household id for those kinds, so
-- the app needs no change and nothing moves.

alter table public.planner_users add column if not exists household_id uuid references public.planner_users(id);
update public.planner_users set household_id = id where household_id is null;

-- the kinds the household shares
create or replace function public.planner_shared_kind(p_kind text)
returns boolean language sql immutable set search_path = public as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs')
$$;

-- which user_id a doc of this kind lives under for this user
create or replace function public.planner_doc_owner(u public.planner_users, p_kind text)
returns uuid language sql immutable set search_path = public as $$
  select case when planner_shared_kind(p_kind) then coalesce(u.household_id, u.id) else u.id end
$$;

create or replace function public.planner_get(p_token text, p_kind text, p_from text default null, p_to text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_owner uuid;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  v_owner := planner_doc_owner(u, p_kind);
  return jsonb_build_object('ok', true, 'docs', (
    select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'data', d.data, 'updated_at', d.updated_at) order by d.key), '[]'::jsonb)
      from planner_docs d
     where d.user_id = v_owner and d.kind = p_kind and jsonb_typeof(d.data) <> 'null'
       and (p_from is null or d.key >= p_from) and (p_to is null or d.key <= p_to)));
end $$;

create or replace function public.planner_put(p_token text, p_kind text, p_key text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_owner uuid;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p_kind is null or p_key is null or length(p_kind) > 40 or length(p_key) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key');
  end if;
  v_owner := planner_doc_owner(u, p_kind);
  insert into planner_docs (user_id, kind, key, data) values (v_owner, p_kind, p_key, coalesce(p_data, 'null'::jsonb))
  on conflict (user_id, kind, key) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.planner_put_many(p_token text, p_docs jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; r jsonb;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    if r->>'kind' is null or r->>'key' is null then continue; end if;
    insert into planner_docs (user_id, kind, key, data) values (planner_doc_owner(u, r->>'kind'), r->>'kind', r->>'key', coalesce(r->'data', 'null'::jsonb))
    on conflict (user_id, kind, key) do update set data = excluded.data, updated_at = now();
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- the profile tells the app which app (and routine shape) this person uses
create or replace function public.planner_profile(u public.planner_users)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'settings', u.settings,
                            'household_id', coalesce(u.household_id, u.id))
$$;

do $$
declare f text;
begin
  foreach f in array array['planner_shared_kind(text)', 'planner_doc_owner(public.planner_users, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- Rosh: her own app at /roshplanner, the morning routine, money shared with Vijay. PIN set by hand.
insert into public.planner_users (username, display_name, settings, household_id)
values ('rosh', 'Rosh', '{"units":"lb","app":"roshplanner","profile":"morning"}'::jsonb, (select id from public.planner_users where username = 'vijay'))
on conflict (username) do nothing;
update public.planner_users set settings = settings || '{"app":"vijayplanner","profile":"night"}'::jsonb where username = 'vijay' and not (settings ? 'app');
