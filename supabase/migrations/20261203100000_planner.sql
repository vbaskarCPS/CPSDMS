-- Vijay Planner (propertystars.app/vijayplanner): a personal planner that lives next to the field app.
--
-- Sign-in is username + PIN, mirroring the worker pass (20261025100000_worker_dashboard.sql): the
-- browser gets a long random token and the database keeps only its hash, for a year. Everything the
-- planner stores is a JSON document under (kind, key) in planner_docs — a day page is kind 'day',
-- key '2026-10-30'; a habit is kind 'habit', key <uuid>; and so on — so new planner screens don't
-- need new tables. The tables are closed under RLS; the only way in is the planner_* functions,
-- which check the token. No PIN is written in this file: it's set once, by hand, with planner_set_pin.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.planner_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username)),
  display_name text not null,
  pin_hash text,
  pin_failures int not null default 0,
  pin_locked_until timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.planner_sessions (
  token_hash text primary key,
  user_id uuid not null references public.planner_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '365 days'
);
create index if not exists planner_sessions_user_idx on public.planner_sessions(user_id);

create table if not exists public.planner_docs (
  user_id uuid not null references public.planner_users(id) on delete cascade,
  kind text not null,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

alter table public.planner_users enable row level security;
alter table public.planner_sessions enable row level security;
alter table public.planner_docs enable row level security;
-- no policies: nothing reaches these tables except the functions below (security definer)

-- ───────────── helpers ─────────────
create or replace function public.planner_token_user(p_token text)
returns public.planner_users language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_hash text;
begin
  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select pu.* into u from planner_sessions s join planner_users pu on pu.id = s.user_id
   where s.token_hash = v_hash and s.expires_at > now();
  if u.id is not null then
    update planner_sessions set last_seen_at = now() where token_hash = v_hash and last_seen_at < now() - interval '1 hour';
  end if;
  return u;
end $$;

create or replace function public.planner_profile(u public.planner_users)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'settings', u.settings)
$$;

-- ───────────── sign in / out ─────────────
-- 5 wrong PINs lock the account for 15 minutes. Same answer for an unknown user and a wrong PIN.
create or replace function public.planner_sign_in(p_username text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_token text;
begin
  select * into u from planner_users where username = lower(trim(coalesce(p_username, '')));
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'wrong'); end if;
  if u.pin_locked_until is not null and u.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', u.pin_locked_until);
  end if;
  if u.pin_hash is null or crypt(coalesce(p_pin, ''), u.pin_hash) <> u.pin_hash then
    update planner_users set pin_failures = pin_failures + 1,
           pin_locked_until = case when pin_failures + 1 >= 5 then now() + interval '15 minutes' else pin_locked_until end
     where id = u.id returning * into u;
    if u.pin_failures >= 5 then update planner_users set pin_failures = 0 where id = u.id; end if;
    return jsonb_build_object('ok', false, 'reason', case when u.pin_locked_until > now() then 'locked' else 'wrong' end, 'until', u.pin_locked_until);
  end if;
  update planner_users set pin_failures = 0, pin_locked_until = null where id = u.id;
  delete from planner_sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into planner_sessions (token_hash, user_id) values (encode(digest(v_token, 'sha256'), 'hex'), u.id);
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', now() + interval '365 days', 'user', planner_profile(u));
end $$;

create or replace function public.planner_sign_out(p_token text)
returns void language sql volatile security definer set search_path = public, extensions as $$
  delete from planner_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.planner_me(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  return jsonb_build_object('ok', true, 'user', planner_profile(u));
end $$;

create or replace function public.planner_save_settings(p_token text, p_settings jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  update planner_users set settings = coalesce(p_settings, '{}'::jsonb) where id = u.id returning * into u;
  return jsonb_build_object('ok', true, 'user', planner_profile(u));
end $$;

-- Change the PIN from inside the app (needs the current one). Signs every other device out.
create or replace function public.planner_change_pin(p_token text, p_old_pin text, p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if u.pin_hash is not null and crypt(coalesce(p_old_pin, ''), u.pin_hash) <> u.pin_hash then
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  if length(coalesce(p_new_pin, '')) < 4 then return jsonb_build_object('ok', false, 'reason', 'short'); end if;
  update planner_users set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = u.id;
  delete from planner_sessions where user_id = u.id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── documents ─────────────
-- planner_get: the docs of one kind, optionally between two keys (inclusive; day keys sort as dates).
create or replace function public.planner_get(p_token text, p_kind text, p_from text default null, p_to text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  return jsonb_build_object('ok', true, 'docs', (
    select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'data', d.data, 'updated_at', d.updated_at) order by d.key), '[]'::jsonb)
      from planner_docs d
     where d.user_id = u.id and d.kind = p_kind
       and (p_from is null or d.key >= p_from) and (p_to is null or d.key <= p_to)));
end $$;

-- planner_put: write (or overwrite) one doc. A null data deletes it — the only delete the planner does.
create or replace function public.planner_put(p_token text, p_kind text, p_key text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p_kind is null or p_key is null or length(p_kind) > 40 or length(p_key) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key');
  end if;
  if p_data is null then
    delete from planner_docs where user_id = u.id and kind = p_kind and key = p_key;
  else
    insert into planner_docs (user_id, kind, key, data) values (u.id, p_kind, p_key, p_data)
    on conflict (user_id, kind, key) do update set data = excluded.data, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- planner_put_many: several docs in one round trip ([{kind, key, data}, ...]).
create or replace function public.planner_put_many(p_token text, p_docs jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; r jsonb;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    if r->>'kind' is null or r->>'key' is null then continue; end if;
    if r->'data' is null or jsonb_typeof(r->'data') = 'null' then
      delete from planner_docs where user_id = u.id and kind = r->>'kind' and key = r->>'key';
    else
      insert into planner_docs (user_id, kind, key, data) values (u.id, r->>'kind', r->>'key', r->'data')
      on conflict (user_id, kind, key) do update set data = excluded.data, updated_at = now();
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── grants ─────────────
do $$
declare f text;
begin
  foreach f in array array['planner_sign_in(text, text)', 'planner_sign_out(text)', 'planner_me(text)',
    'planner_save_settings(text, jsonb)', 'planner_change_pin(text, text, text)',
    'planner_get(text, text, text, text)', 'planner_put(text, text, text, jsonb)', 'planner_put_many(text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  -- internal helpers: nobody calls these from the browser
  foreach f in array array['planner_token_user(text)', 'planner_profile(public.planner_users)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- The one planner user. The PIN is set by hand afterwards:
--   update planner_users set pin_hash = extensions.crypt('<pin>', extensions.gen_salt('bf')) where username = 'vijay';
insert into public.planner_users (username, display_name, settings)
values ('vijay', 'Vijay', '{"units":"lb","wake_time":"05:00"}'::jsonb)
on conflict (username) do nothing;
