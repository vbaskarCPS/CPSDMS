-- Minigame accounts (propertystars.app/minigame): a few named players, each with a 4-digit PIN,
-- and saved progress per player per game. Separate from the work app's users on purpose.
--
-- Additive only. The tables are closed to the public key (RLS on, no grants); the page reaches
-- them only through the minigame_* functions below. The PIN is set by each player on their first
-- sign-in and is stored only as a bcrypt hash. To reset someone's PIN, clear it and they choose a
-- new one next time:  update minigame_players set pin_hash = null where name = 'Rosh';
-- Players are added only here, by SQL:  insert into minigame_players (name) values ('Name');

create table if not exists public.minigame_players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 40),
  pin_hash text,
  pin_failed int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.minigame_passes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  player_id uuid not null references public.minigame_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);
create index if not exists minigame_passes_player_idx on public.minigame_passes (player_id);

create table if not exists public.minigame_progress (
  player_id uuid not null references public.minigame_players(id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9_-]{1,40}$'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (player_id, game)
);

alter table public.minigame_players enable row level security;
alter table public.minigame_passes enable row level security;
alter table public.minigame_progress enable row level security;
revoke all on public.minigame_players, public.minigame_passes, public.minigame_progress from anon, authenticated;

-- the signed-in player behind a pass token (null if none or expired) — internal only
create or replace function public.minigame_player_of(p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select p.player_id from minigame_passes p
   where p.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and p.expires_at > now()
$$;
revoke all on function public.minigame_player_of(text) from public, anon, authenticated;

-- who can play (names only, and whether they've set a PIN yet)
create or replace function public.minigame_players_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'has_pin', pin_hash is not null) order by name), '[]'::jsonb)
    from minigame_players
$$;

-- Sign in with a 4-digit PIN. The very first sign-in sets the PIN. Five wrong tries lock the
-- player for 15 minutes. Returns {ok, token, name} or {ok:false, reason}.
create or replace function public.minigame_sign_in(p_player uuid, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pl minigame_players; v_token text; ok boolean; fails int;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'reason', 'pin_format'); end if;
  select * into pl from minigame_players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if pl.pin_locked_until is not null and pl.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', pl.pin_locked_until);
  end if;
  if pl.pin_hash is null then
    update minigame_players set pin_hash = crypt(p_pin, gen_salt('bf')), pin_failed = 0, pin_locked_until = null where id = pl.id;
  else
    ok := pl.pin_hash = crypt(p_pin, pl.pin_hash);
    fails := case when pl.pin_locked_until is not null then 0 else pl.pin_failed end;
    update minigame_players
       set pin_failed = case when ok then 0 else fails + 1 end,
           pin_locked_until = case when ok then null when fails + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = pl.id;
    if not ok then
      return jsonb_build_object('ok', false, 'reason', case when fails + 1 >= 5 then 'locked' else 'wrong' end, 'tries_left', greatest(0, 4 - fails));
    end if;
  end if;
  delete from minigame_passes where expires_at <= now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into minigame_passes (token_hash, player_id) values (encode(digest(v_token, 'sha256'), 'hex'), pl.id);
  return jsonb_build_object('ok', true, 'token', v_token, 'id', pl.id, 'name', pl.name, 'new_pin', pl.pin_hash is null);
end $$;

-- who this phone is signed in as (null if the pass has expired or been signed out)
create or replace function public.minigame_me(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pl.id, 'name', pl.name) from minigame_players pl where pl.id = minigame_player_of(p_token)
$$;

create or replace function public.minigame_sign_out(p_token text)
returns void language sql volatile security definer set search_path = public, extensions as $$
  delete from minigame_passes where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- every game's saved progress for the signed-in player: { "pour": {...}, "chess": {...} }
create or replace function public.minigame_progress_all(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return coalesce((select jsonb_object_agg(game, data) from minigame_progress where player_id = me), '{}'::jsonb);
end $$;

-- save one game's progress (the game decides what goes in it)
create or replace function public.minigame_save(p_token text, p_game text, p_data jsonb)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); t timestamptz := now();
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  insert into minigame_progress (player_id, game, data, updated_at) values (me, p_game, coalesce(p_data, '{}'::jsonb), t)
  on conflict (player_id, game) do update set data = excluded.data, updated_at = t;
  return t;
end $$;

revoke all on function public.minigame_players_list(), public.minigame_sign_in(uuid, text), public.minigame_me(text),
  public.minigame_sign_out(text), public.minigame_progress_all(text), public.minigame_save(text, text, jsonb) from public;
grant execute on function public.minigame_players_list(), public.minigame_sign_in(uuid, text), public.minigame_me(text),
  public.minigame_sign_out(text), public.minigame_progress_all(text), public.minigame_save(text, text, jsonb) to anon, authenticated;

-- the first two players; each sets their own PIN on first sign-in
insert into public.minigame_players (name) values ('Vijay'), ('Rosh') on conflict (name) do nothing;
