-- The planner on a watch (Wear OS). A watch can't type a PIN comfortably, so it is paired from the phone:
--   1. the watch opens and calls planner_watch_start with a long random secret it keeps; it gets a 4-digit code back
--      and shows it ("Connect to your planner: on your phone, Settings › Watch, then enter 4827");
--   2. on the phone, signed in, Settings › Watch sends that code (planner_watch_claim): the pairing now belongs to
--      that person;
--   3. the watch asks every few seconds with its secret (planner_watch_poll); once the pairing is claimed it gets a
--      planner token of its own, like a phone signing in (a planner_sessions row marked device 'watch'), and from
--      then on uses the same planner_get / planner_put functions as the phone.
-- A code lasts 5 minutes and is only good once. The secret never leaves the watch except as this call's argument,
-- and only its hash is kept. Codes are unique among the ones still waiting. A phone that sends 5 wrong codes waits
-- 10 minutes. Settings › Watch lists the watches that are signed in and can sign one out (planner_watch_list,
-- planner_watch_forget). Changing the PIN signs watches out too, like every other device.
-- Additive: a column, a table, five functions.

alter table public.planner_sessions add column if not exists device text;

create table if not exists public.planner_watch_pairs (
  id bigint generated always as identity primary key,
  secret_hash text not null unique,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  user_id uuid references public.planner_users(id),
  claimed_at timestamptz,
  collected_at timestamptz
);
create index if not exists planner_watch_pairs_code_idx on public.planner_watch_pairs (code, expires_at);
alter table public.planner_watch_pairs enable row level security;
revoke all on public.planner_watch_pairs from anon, authenticated;

-- failed claims per person, for the 5-wrong-codes pause
create table if not exists public.planner_watch_claim_misses (
  user_id uuid not null references public.planner_users(id),
  at timestamptz not null default now()
);
create index if not exists planner_watch_claim_misses_idx on public.planner_watch_claim_misses (user_id, at);
alter table public.planner_watch_claim_misses enable row level security;
revoke all on public.planner_watch_claim_misses from anon, authenticated;

/** The watch: start pairing. p_secret = at least 32 random characters the watch keeps. Returns the code to show. */
create or replace function public.planner_watch_start(p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_hash text; v_code text; i int := 0;
begin
  if length(coalesce(p_secret, '')) < 32 or length(p_secret) > 200 then return jsonb_build_object('ok', false, 'reason', 'bad_secret'); end if;
  v_hash := encode(digest(p_secret, 'sha256'), 'hex');
  -- the same watch asking again gets its waiting code back
  select code into v_code from planner_watch_pairs where secret_hash = v_hash and expires_at > now() and claimed_at is null;
  if v_code is not null then
    return jsonb_build_object('ok', true, 'code', v_code,
      'expires_at', (select expires_at from planner_watch_pairs where secret_hash = v_hash));
  end if;
  if exists (select 1 from planner_watch_pairs where secret_hash = v_hash) then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  loop
    i := i + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from planner_watch_pairs where code = v_code and expires_at > now() and collected_at is null);
    if i > 50 then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  end loop;
  insert into planner_watch_pairs (secret_hash, code) values (v_hash, v_code);
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', now() + interval '5 minutes');
end $$;

/** The phone, signed in: claim the code a watch is showing. */
create or replace function public.planner_watch_claim(p_token text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_id bigint;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if (select count(*) from planner_watch_claim_misses where user_id = u.id and at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'wait');
  end if;
  select id into v_id from planner_watch_pairs
   where code = trim(coalesce(p_code, '')) and expires_at > now() and claimed_at is null
   order by id desc limit 1;
  if v_id is null then
    insert into planner_watch_claim_misses (user_id) values (u.id);
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  update planner_watch_pairs set user_id = u.id, claimed_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

/** The watch: has the phone claimed it yet? Once it has, the watch gets its token (once). */
create or replace function public.planner_watch_poll(p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare p planner_watch_pairs; u planner_users; v_token text;
begin
  select * into p from planner_watch_pairs where secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex');
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if p.collected_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if p.claimed_at is null then
    if p.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
    return jsonb_build_object('ok', true, 'waiting', true);
  end if;
  select * into u from planner_users where id = p.user_id;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into planner_sessions (token_hash, user_id, device) values (encode(digest(v_token, 'sha256'), 'hex'), u.id, 'watch');
  update planner_watch_pairs set collected_at = now() where id = p.id;
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', now() + interval '365 days', 'user', planner_profile(u));
end $$;

/** The phone: the watches signed in to this planner. */
create or replace function public.planner_watch_list(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  return jsonb_build_object('ok', true, 'watches', (
    select coalesce(jsonb_agg(jsonb_build_object('id', left(s.token_hash, 12), 'since', s.created_at, 'last_seen', s.last_seen_at) order by s.created_at), '[]'::jsonb)
      from planner_sessions s where s.user_id = u.id and s.device = 'watch' and s.expires_at > now()));
end $$;

/** The phone: sign a watch out (p_id from planner_watch_list), or every watch when p_id is null. */
create or replace function public.planner_watch_forget(p_token text, p_id text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  update planner_sessions set expires_at = now()
   where user_id = u.id and device = 'watch' and expires_at > now() and (p_id is null or left(token_hash, 12) = p_id);
  return jsonb_build_object('ok', true);
end $$;

do $g$
declare f text;
begin
  foreach f in array array['planner_watch_start(text)', 'planner_watch_claim(text,text)', 'planner_watch_poll(text)',
                           'planner_watch_list(text)', 'planner_watch_forget(text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $g$;
